import type { CredentialSecret } from '@manablox/core';
import {
  CREDENTIAL_KIND_SPECS,
  CREDENTIAL_KINDS,
  type CredentialKind,
  type CredentialView,
  type ErrorDetail,
  ManabloxError,
  slugify,
} from '@manablox/core';
import { decryptSecret, encryptSecret, type Manablox, secretHint } from '@manablox/core/node';
import type { CredentialRow, Paginated, Pagination, Repositories } from '@manablox/db';
import { credentialAuditor, requireInSpace } from '../lib.js';

export interface CredentialInput {
  name: string;
  slug?: string | undefined;
  kind: CredentialKind;
  provider?: string | undefined;
  /** Field name -> value. An omitted secret field keeps its stored value. */
  data: Record<string, string>;
}

/**
 * The credential vault: one encrypted blob per credential, used by workflow actions and
 * webhooks. Secrets leave only through `resolve`, whose values callers redact.
 */
export class CredentialService {
  private readonly audit;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
  ) {
    this.audit = credentialAuditor(repos);
  }

  /** This service on other repositories, e.g. a transaction's. */
  using(repos: Repositories): CredentialService {
    return new CredentialService(this.manablox, repos);
  }

  /** A page of the space's credentials by name, without secrets. */
  async page(spaceId: string, pagination?: Pagination): Promise<Paginated<CredentialView>> {
    const page = await this.repos.credentials.pageBySpace(spaceId, pagination);
    return { ...page, items: this.views(page.items) };
  }

  /** Rows already loaded, as `page` returns them. */
  views(rows: CredentialRow[]): CredentialView[] {
    return rows.map((row) => this.view(row));
  }

  async get(spaceId: string, id: string): Promise<CredentialView> {
    return this.view(await this.find(spaceId, id));
  }

  async create(spaceId: string, input: CredentialInput): Promise<CredentialView> {
    const valid = this.validate(input, {});
    const slug = await this.uniqueSlug(spaceId, valid.slug, null);
    const row = await this.repos.transaction(async (tx) => {
      const row = await tx.credentials.create({
        spaceId,
        name: valid.name,
        slug,
        kind: valid.kind,
        provider: valid.provider,
        data: this.seal(valid.data),
        hint: this.hintOf(valid.kind, valid.data),
      });
      await this.audit.in(tx).record('credential.create', row);
      return row;
    });
    return this.view(row);
  }

  /** An empty slot for an import, with a planned id; its secret is filled in later. */
  async createSlot(
    spaceId: string,
    slot: {
      id: string;
      name: string;
      slug: string;
      kind: CredentialKind;
      provider: string;
    },
    via: string,
  ): Promise<CredentialRow> {
    const valid = this.validate({ ...slot, data: {} }, {}, false);
    const row = await this.repos.credentials.create({
      id: slot.id,
      spaceId,
      name: valid.name,
      slug: await this.uniqueSlug(spaceId, valid.slug, null),
      kind: valid.kind,
      provider: valid.provider,
      data: null,
      hint: null,
    });
    await this.audit.record('credential.create', row, undefined, { via });
    return row;
  }

  async update(spaceId: string, id: string, input: CredentialInput): Promise<CredentialView> {
    const before = await this.find(spaceId, id);
    const stored = this.open(before);
    const valid = this.validate(input, stored);
    const slug = await this.uniqueSlug(spaceId, valid.slug, id);
    const row = await this.repos.transaction(async (tx) => {
      const row = await tx.credentials.update(id, {
        name: valid.name,
        slug,
        kind: valid.kind,
        provider: valid.provider,
        data: this.seal(valid.data),
        hint: this.hintOf(valid.kind, valid.data),
      });
      await this.audit.in(tx).record('credential.update', row);
      return row;
    });
    return this.view(row);
  }

  async delete(spaceId: string, id: string): Promise<void> {
    const row = await this.find(spaceId, id);
    // Code slots may be filled in but not deleted.
    if (row.source === 'code') {
      throw ManabloxError.forbidden('credential.code.immutable', {
        name: row.name,
        sourceRef: row.sourceRef,
      });
    }
    await this.repos.transaction(async (tx) => {
      await tx.credentials.delete(id);
      await this.audit.in(tx).record('credential.delete', row);
    });
  }

  /** The decrypted credential; throws if it belongs to another space. */
  async resolve(spaceId: string, id: string): Promise<CredentialSecret> {
    const row = await this.find(spaceId, id);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      provider: row.provider,
      data: this.open(row),
    };
  }

  /** Encrypts a field map and its hint, for the code-resource reconciler. */
  sealFields(
    kind: CredentialKind,
    values: Record<string, string>,
  ): { data: string; hint: string | null } {
    return { data: this.seal(values), hint: this.hintOf(kind, values) };
  }

  /** Compares decrypted values; ciphertexts differ per nonce. */
  matchesFields(row: CredentialRow, values: Record<string, string>): boolean {
    const stored = this.open(row);
    const names = new Set([...Object.keys(stored), ...Object.keys(values)]);
    return [...names].every((name) => stored[name] === values[name]);
  }

  /** Whether a stored credential actually holds a secret. */
  hasSecret(row: CredentialRow): boolean {
    if (!row.data) return false;
    const spec = CREDENTIAL_KIND_SPECS[row.kind];
    const stored = this.open(row);
    // Free-form credentials declare no fields; any value counts.
    const secretFields = (spec?.fields ?? []).filter((field) => field.secret);
    if (secretFields.length === 0) return Object.keys(stored).length > 0;
    return secretFields.some((field) => Boolean(stored[field.name]));
  }

  // --- internals -----------------------------------------------------------------

  private view(row: CredentialRow): CredentialView {
    const spec = CREDENTIAL_KIND_SPECS[row.kind];
    const secretFields = new Set(
      (spec?.fields ?? []).filter((field) => field.secret).map((field) => field.name),
    );
    const stored = this.open(row);
    // Only non-secret fields are returned; secrets show as `hint`.
    const data = Object.fromEntries(
      Object.entries(stored).filter(([name]) => !secretFields.has(name)),
    );
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      provider: row.provider,
      data,
      hint: row.hint,
      source: row.source,
      sourceRef: row.sourceRef,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private seal(data: Record<string, string>): string {
    return encryptSecret(JSON.stringify(data), this.secret());
  }

  private open(row: CredentialRow): Record<string, string> {
    if (!row.data) return {};
    const parsed: unknown = JSON.parse(decryptSecret(row.data, this.secret()));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  }

  private secret(): string {
    return this.manablox.config.auth.secret ?? '';
  }

  private hintOf(kind: CredentialKind, data: Record<string, string>): string | null {
    const spec = CREDENTIAL_KIND_SPECS[kind];
    const first = (spec?.fields ?? []).find((field) => field.secret && data[field.name]);
    return first ? secretHint(data[first.name] as string) : null;
  }

  /** Validates declared fields, falling back to stored values for omitted ones. */
  private validate(input: CredentialInput, stored: Record<string, string>, requireFields = true) {
    const problems: ErrorDetail[] = [];
    const name = input.name.trim();
    if (!name) problems.push({ key: 'credential.name.required', path: ['name'] });

    if (!(CREDENTIAL_KINDS as readonly string[]).includes(input.kind)) {
      problems.push({
        key: 'credential.kind.unknown',
        path: ['kind'],
        params: { kind: input.kind },
      });
      throw ManabloxError.validation(problems, 'credential.validation.failed');
    }

    const spec = CREDENTIAL_KIND_SPECS[input.kind];
    const data: Record<string, string> = {};
    for (const field of spec.fields) {
      const given = input.data[field.name];
      const value = (given === undefined || given === '' ? stored[field.name] : given) ?? '';
      if (requireFields && field.required && !value.trim()) {
        problems.push({
          key: 'credential.field.required',
          path: ['data', field.name],
          params: { field: field.label },
        });
      }
      if (value) data[field.name] = value;
    }
    // Free-form credentials keep every given value.
    if (input.kind === 'custom') {
      for (const [key, value] of Object.entries(input.data)) if (value) data[key] = value;
    }

    const slug = slugify(input.slug?.trim() || name);
    if (!slug) problems.push({ key: 'credential.slug.invalid', path: ['slug'] });

    if (problems.length) throw ManabloxError.validation(problems, 'credential.validation.failed');
    return { name, slug, kind: input.kind, provider: input.provider?.trim() ?? '', data };
  }

  /** Appends `-2`, `-3`, ... to a taken slug. */
  private async uniqueSlug(spaceId: string, slug: string, ownId: string | null): Promise<string> {
    const taken = new Set(
      (await this.repos.credentials.listBySpace(spaceId))
        .filter((row) => row.id !== ownId)
        .map((row) => row.slug),
    );
    if (!taken.has(slug)) return slug;
    for (let n = 2; n < 500; n++) {
      const candidate = `${slug}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw ManabloxError.conflict('credential.slug.taken', { slug });
  }

  private async find(spaceId: string, id: string): Promise<CredentialRow> {
    return requireInSpace(
      await this.repos.credentials.findById(id),
      spaceId,
      'credential.notFound',
      { id },
    );
  }
}
