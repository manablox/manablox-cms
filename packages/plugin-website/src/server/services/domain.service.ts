import {
  diffRecords,
  type Loose,
  ManabloxError,
  purgeTags,
  type Scope,
  scopeOf,
  scopeSpaceId,
  snapshotChanges,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type Repositories, uniqueViolation, whenCommitted } from '@manablox/db';
import {
  environmentPayload,
  type HostVerificationView,
  HostVerifier,
  hookScope,
  normaliseHostname,
  requireInSpace,
} from '@manablox/services';
import { siteCacheTags } from '../../shared/site.js';
import { domainAuditor } from '../audit.js';
import type { SiteDomainRow, SiteDomainWriteData } from '../db/index.js';
import { websiteRepos } from '../db/index.js';
import { websiteKeys } from '../keys.js';

export type { SiteDomainRow };

/** The `kind` of site domains in host checks and `domain.*` events. */
export const SITE_HOST_KIND = 'site';

/** A domain with what the admin shows to verify it. */
export type SiteDomainView = SiteDomainRow & { verification: HostVerificationView };

export interface SiteDomainInput {
  hostname: string;
  locale?: string | null | undefined;
  isPrimary?: boolean | undefined;
  redirectToPrimary?: boolean | undefined;
}

/** What the site process needs to serve a host. */
export interface ResolvedHost {
  spaceId: string;
  /** The environment the host belongs to. */
  environmentId: string;
  hostname: string;
  /** The pinned locale; `null` resolves the locale by path prefix. */
  locale: string | null;
  /** The primary host to 301 to, when this one redirects. */
  redirectTo: string | null;
}

const hostnameConflict = uniqueViolation({
  constraint: 'hostname',
  key: 'plugins.website.domain.hostname.taken',
  path: ['hostname'],
  errorKey: 'plugins.website.domain.validation.failed',
});

const invalid = (
  key:
    | 'plugins.website.domain.hostname.invalid'
    | 'plugins.website.domain.hostname.taken'
    | 'plugins.website.domain.locale.unknown',
  path: string,
  params: Record<string, unknown>,
) =>
  ManabloxError.validation(
    [{ key, path: [path], params }],
    'plugins.website.domain.validation.failed',
  );

/** Host names a designed site answers on; one primary per space and locale. */
export class SiteDomainService {
  private readonly audit;
  readonly verifier: HostVerifier;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    verifier?: HostVerifier,
  ) {
    this.audit = domainAuditor(repos);
    this.verifier = verifier ?? new HostVerifier(manablox, repos);
  }

  using(repos: Repositories): SiteDomainService {
    return new SiteDomainService(this.manablox, repos, this.verifier);
  }

  async list(scope: Scope): Promise<SiteDomainView[]> {
    return this.views(await websiteRepos(this.repos).domains.listBySpace(scope));
  }

  async get(scope: Scope, id: string): Promise<SiteDomainView> {
    return this.view(await this.find(scope, id));
  }

  /** Checks the domain's DNS now; verified on a TXT or CNAME match. */
  async verify(scope: Scope, id: string): Promise<SiteDomainView> {
    const row = await this.verifier.check(SITE_HOST_KIND, await this.find(scope, id));
    return this.view(row);
  }

  /** The space a request's `Host` belongs to; `null` for an unknown or unverified host. */
  async resolveHost(host: string): Promise<ResolvedHost | null> {
    const hostname = normaliseHostname(host);
    if (!hostname) return null;
    const row = await websiteRepos(this.repos).domains.findByHostname(hostname);
    if (!row || (await this.verifier.blocks(row))) return null;
    let redirectTo: string | null = null;
    if (row.redirectToPrimary && !row.isPrimary) {
      const primary = await websiteRepos(this.repos).domains.findPrimary(scopeOf(row), row.locale);
      if (primary && primary.hostname !== row.hostname && !(await this.verifier.blocks(primary))) {
        redirectTo = primary.hostname;
      }
    }
    return {
      spaceId: row.spaceId,
      environmentId: row.environmentId,
      hostname: row.hostname,
      locale: row.locale,
      redirectTo,
    };
  }

  /**
   * The first host of a space and locale becomes its primary. Needs `customDomains` and
   * `features.plugins.website.domains`.
   */
  async create(scope: Scope, input: SiteDomainInput): Promise<SiteDomainView> {
    const spaceId = scopeSpaceId(scope);
    await this.manablox.controls.assertFeature(spaceId, 'customDomains');
    await this.manablox.controls.assertFeature(spaceId, websiteKeys.features.domains);
    const data = await this.prepare(scope, input, null);
    await this.manablox.hooks.run(
      'website:beforeDomainCreate',
      { spaceId, hostname: data.hostname, locale: data.locale },
      { manablox: this.manablox, ...hookScope(scope) },
    );
    await this.manablox.controls.assertLimit(scope, 'customDomains');
    const verification = await this.verifier.initial();
    const created = await this.repos.transaction(async (tx) => {
      const first = !(await websiteRepos(tx).domains.findPrimary(scope, data.locale));
      const values = { ...data, ...verification, isPrimary: data.isPrimary || first };
      if (values.isPrimary) values.redirectToPrimary = false;
      const row = await websiteRepos(tx)
        .domains.create(scope, values)
        .catch(hostnameConflict({ hostname: data.hostname }));
      if (row.isPrimary) await websiteRepos(tx).domains.clearPrimary(scope, row.locale, row.id);
      await this.audit.in(tx).record('website.domain.create', row, snapshotChanges(row, 'created'));
      await this.domainEvent('domain.added', row, tx);
      await this.purge(tx, scopeSpaceId(scope));
      return row;
    });
    return this.view(created);
  }

  /** Needs `features.plugins.website.domains`. */
  async update(scope: Scope, id: string, input: Loose<SiteDomainInput>): Promise<SiteDomainView> {
    await this.manablox.controls.assertFeature(scopeSpaceId(scope), websiteKeys.features.domains);
    const before = await this.find(scope, id);
    const data = await this.prepare(
      scope,
      {
        hostname: input.hostname ?? before.hostname,
        locale: input.locale === undefined ? before.locale : input.locale,
        isPrimary: input.isPrimary ?? before.isPrimary,
        redirectToPrimary: input.redirectToPrimary ?? before.redirectToPrimary,
      },
      id,
    );
    if (data.isPrimary) data.redirectToPrimary = false;
    // A new name proves ownership again.
    if (data.hostname !== before.hostname) Object.assign(data, await this.verifier.initial());
    const updated = await this.repos.transaction(async (tx) => {
      const row = await websiteRepos(tx)
        .domains.update(id, scope, data)
        .catch(hostnameConflict({ hostname: data.hostname }));
      if (!row) throw ManabloxError.notFound('plugins.website.domain.notFound', { id });
      if (row.isPrimary) await websiteRepos(tx).domains.clearPrimary(scope, row.locale, row.id);
      await this.audit.in(tx).record('website.domain.update', row, diffRecords(before, row));
      if (row.hostname !== before.hostname) {
        await this.domainEvent('domain.removed', before, tx);
        await this.domainEvent('domain.added', row, tx);
      }
      await this.purge(tx, scopeSpaceId(scope));
      return row;
    });
    return this.view(updated);
  }

  async delete(scope: Scope, id: string): Promise<void> {
    const row = await this.find(scope, id);
    await this.repos.transaction(async (tx) => {
      await websiteRepos(tx).domains.delete(id, scope);
      await this.audit.in(tx).record('website.domain.delete', row, snapshotChanges(row, 'deleted'));
      await this.domainEvent('domain.removed', row, tx);
      await this.purge(tx, scopeSpaceId(scope));
    });
  }

  // -------------------------------------------------------------------------

  private async prepare(
    scope: Scope,
    input: SiteDomainInput,
    id: string | null,
  ): Promise<SiteDomainWriteData> {
    const spaceId = scopeSpaceId(scope);
    const space = await this.repos.spaces.findById(spaceId);
    if (!space) throw ManabloxError.notFound('space.notFound', { spaceId });
    const hostname = normaliseHostname(input.hostname);
    if (!hostname) {
      throw invalid('plugins.website.domain.hostname.invalid', 'hostname', {
        hostname: input.hostname,
      });
    }
    const locale = input.locale ?? null;
    if (locale !== null && !space.locales.includes(locale)) {
      throw invalid('plugins.website.domain.locale.unknown', 'locale', { locale });
    }
    const taken = await this.verifier.owner(hostname);
    if (taken && !(taken.source.kind === SITE_HOST_KIND && taken.row.id === id))
      throw invalid('plugins.website.domain.hostname.taken', 'hostname', { hostname });
    return {
      hostname,
      locale,
      isPrimary: input.isPrimary ?? false,
      redirectToPrimary: input.redirectToPrimary ?? false,
    };
  }

  private async find(scope: Scope, id: string): Promise<SiteDomainRow> {
    return requireInSpace(
      await websiteRepos(this.repos).domains.findById(id, scope),
      scope,
      'plugins.website.domain.notFound',
      { id },
    );
  }

  private async domainEvent(
    type: 'domain.added' | 'domain.removed',
    row: SiteDomainRow,
    tx: Repositories,
  ): Promise<void> {
    return this.manablox.controls.emit(
      type,
      { kind: 'space', id: row.spaceId },
      {
        spaceId: row.spaceId,
        ...(await environmentPayload(tx, row)),
        domainId: row.id,
        hostname: row.hostname,
        kind: SITE_HOST_KIND,
        locale: row.locale,
      },
      { tx },
    );
  }

  private async view(row: SiteDomainRow): Promise<SiteDomainView> {
    return (await this.views([row]))[0] as SiteDomainView;
  }

  private async views(rows: SiteDomainRow[]): Promise<SiteDomainView[]> {
    const required = await this.verifier.required();
    return rows.map((row) => ({ ...row, verification: this.verifier.view(row, required) }));
  }

  private purge(repos: Repositories, spaceId: string): Promise<void> {
    return whenCommitted(repos, () => purgeTags(this.manablox, spaceId, [siteCacheTags.domains]));
  }
}
