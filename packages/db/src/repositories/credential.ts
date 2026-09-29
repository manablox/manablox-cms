import {
  type CredentialKind,
  type Loose,
  ManabloxError,
  type ResourceSource,
} from '@manablox/core';
import { eq, inArray } from 'drizzle-orm';
import { firstPage, type Paginated } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { CredentialRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface CredentialWriteData {
  /** Lets an import keep the id its nodes reference. */
  id?: string | undefined;
  spaceId: string;
  name: string;
  slug: string;
  kind: CredentialKind;
  provider?: string | undefined;
  source?: ResourceSource | undefined;
  sourceRef?: string | null | undefined;
  /** Already encrypted. */
  data?: string | null | undefined;
  hint?: string | null | undefined;
}

/** A space's credentials (the vault); the data column is already encrypted. */
export class CredentialRepository extends Repository {
  async listBySpace(spaceId: string): Promise<CredentialRow[]> {
    const { credentials } = this.t;
    return this.db
      .select()
      .from(credentials)
      .where(eq(credentials.spaceId, spaceId))
      .orderBy(credentials.name);
  }

  /** A page of a space's credentials by name. */
  pageBySpace(
    spaceId: string,
    pagination: Pagination = firstPage(),
  ): Promise<Paginated<CredentialRow>> {
    const { credentials } = this.t;
    return this.paginate(
      credentials,
      eq(credentials.spaceId, spaceId),
      [credentials.name, credentials.id],
      pagination,
    );
  }

  /** Every space's credentials by name, keyed by space id. */
  listBySpaces(spaceIds: readonly string[]): Promise<Map<string, CredentialRow[]>> {
    const { credentials } = this.t;
    return this.bySpaces(spaceIds, (batch) =>
      this.db
        .select()
        .from(credentials)
        .where(inArray(credentials.spaceId, batch))
        .orderBy(credentials.name),
    );
  }

  findById(id: string): Promise<CredentialRow | null> {
    return this.findOne(this.t.credentials, id);
  }

  async create(data: CredentialWriteData): Promise<CredentialRow> {
    const { credentials } = this.t;
    const [row] = await this.db
      .insert(credentials)
      .values({
        ...(data.id ? { id: data.id } : {}),
        spaceId: data.spaceId,
        name: data.name,
        slug: data.slug,
        kind: data.kind,
        provider: data.provider ?? '',
        source: data.source ?? 'runtime',
        sourceRef: data.sourceRef ?? null,
        data: data.data ?? null,
        hint: data.hint ?? null,
      })
      .returning();
    if (!row) throw new ManabloxError('credential.create.failed');
    return row;
  }

  async update(
    id: string,
    data: Loose<Omit<CredentialWriteData, 'spaceId'>>,
  ): Promise<CredentialRow> {
    const { credentials } = this.t;
    const [row] = await this.db
      .update(credentials)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.kind !== undefined ? { kind: data.kind } : {}),
        ...(data.provider !== undefined ? { provider: data.provider } : {}),
        ...(data.source !== undefined ? { source: data.source } : {}),
        ...(data.sourceRef !== undefined ? { sourceRef: data.sourceRef } : {}),
        ...(data.data !== undefined ? { data: data.data } : {}),
        ...(data.hint !== undefined ? { hint: data.hint } : {}),
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('credential.notFound', { id });
    return row;
  }

  delete(id: string): Promise<boolean> {
    return this.removeOne(this.t.credentials, id);
  }
}
