import {
  type EnvironmentCreateMode,
  type EnvironmentKind,
  ManabloxError,
  PRODUCTION_ENVIRONMENT,
  type ResolvedScope,
  type Scope,
} from '@manablox/core';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import type { SpaceEnvironmentRow } from '../schema/index.js';
import type { Tables } from '../tables.js';
import { Repository } from './base.js';

export interface EnvironmentCreateData {
  id?: string | undefined;
  spaceId: string;
  machineName: string;
  name: string;
  kind: EnvironmentKind;
  createdFrom?: string | null | undefined;
  createdMode?: EnvironmentCreateMode | null | undefined;
}

/** Kind per environment id; a kind never changes, so entries never go stale. */
const kinds = new Map<string, EnvironmentKind>();
/** Environments by id for `resolve`; space, machine name and kind never change. */
const resolved = new Map<
  string,
  Pick<SpaceEnvironmentRow, 'id' | 'spaceId' | 'machineName' | 'kind'>
>();
const KINDS_KEPT = 10_000;

/** Which of `ids` are production environments. */
export async function productionIds(
  db: Executor,
  t: Tables,
  ids: readonly string[],
): Promise<Set<string>> {
  const unknown = [...new Set(ids)].filter((id) => !kinds.has(id));
  if (unknown.length) {
    const { spaceEnvironments: e } = t;
    const rows = await db.select({ id: e.id, kind: e.kind }).from(e).where(inArray(e.id, unknown));
    if (kinds.size + rows.length > KINDS_KEPT) kinds.clear();
    for (const row of rows) kinds.set(row.id, row.kind);
  }
  return new Set(ids.filter((id) => kinds.get(id) === 'production'));
}

/** Inserts a space's production environment on `db`. */
export async function insertProduction(
  db: Executor,
  t: Tables,
  spaceId: string,
): Promise<SpaceEnvironmentRow> {
  const [row] = await db
    .insert(t.spaceEnvironments)
    .values({
      spaceId,
      machineName: PRODUCTION_ENVIRONMENT,
      name: 'Production',
      kind: 'production',
    })
    .returning();
  if (!row) throw new ManabloxError('environment.create.failed');
  return row;
}

/** The environments of each space; exactly one per space is `production`. */
export class EnvironmentRepository extends Repository {
  /** Production first, then by machine name. */
  listBySpace(spaceId: string): Promise<SpaceEnvironmentRow[]> {
    const { spaceEnvironments: e } = this.t;
    return this.db
      .select()
      .from(e)
      .where(eq(e.spaceId, spaceId))
      .orderBy(sql`case when ${e.kind} = 'production' then 0 else 1 end`, asc(e.machineName));
  }

  /** Every environment of the spaces, keyed by space id; every id gets an entry. */
  listBySpaces(spaceIds: readonly string[]): Promise<Map<string, SpaceEnvironmentRow[]>> {
    const { spaceEnvironments: e } = this.t;
    return this.bySpaces(spaceIds, (batch) =>
      this.db
        .select()
        .from(e)
        .where(inArray(e.spaceId, batch))
        .orderBy(sql`case when ${e.kind} = 'production' then 0 else 1 end`, asc(e.machineName)),
    );
  }

  findById(id: string): Promise<SpaceEnvironmentRow | null> {
    return this.findOne(this.t.spaceEnvironments, id);
  }

  /**
   * A scope with its environment's machine name and kind; `null` for an unknown environment
   * or one of another space. A space id alone resolves to its production environment.
   */
  async resolve(scope: Scope): Promise<ResolvedScope | null> {
    if (typeof scope !== 'string' && 'production' in scope && 'machineName' in scope) {
      return scope as ResolvedScope;
    }
    const row =
      typeof scope === 'string'
        ? await this.production(scope)
        : (resolved.get(scope.environmentId) ?? (await this.findById(scope.environmentId)));
    if (!row) return null;
    if (resolved.size >= KINDS_KEPT) resolved.clear();
    resolved.set(row.id, row);
    if (typeof scope !== 'string' && row.spaceId !== scope.spaceId) return null;
    return {
      spaceId: row.spaceId,
      environmentId: row.id,
      machineName: row.machineName,
      production: row.kind === 'production',
    };
  }

  findByMachineName(spaceId: string, machineName: string): Promise<SpaceEnvironmentRow | null> {
    const { spaceEnvironments: e } = this.t;
    return this.findOneWhere(e, and(eq(e.spaceId, spaceId), eq(e.machineName, machineName)));
  }

  /** The space's production environment; `null` only for an unknown space. */
  production(spaceId: string): Promise<SpaceEnvironmentRow | null> {
    const { spaceEnvironments: e } = this.t;
    return this.findOneWhere(e, and(eq(e.spaceId, spaceId), eq(e.kind, 'production')));
  }

  async create(data: EnvironmentCreateData): Promise<SpaceEnvironmentRow> {
    const [row] = await this.db
      .insert(this.t.spaceEnvironments)
      .values({
        ...(data.id ? { id: data.id } : {}),
        spaceId: data.spaceId,
        machineName: data.machineName,
        name: data.name,
        kind: data.kind,
        createdFrom: data.createdFrom ?? null,
        createdMode: data.createdMode ?? null,
      })
      .returning();
    if (!row) throw new ManabloxError('environment.create.failed');
    return row;
  }

  async rename(id: string, name: string): Promise<SpaceEnvironmentRow> {
    const { spaceEnvironments: e } = this.t;
    const [row] = await this.db
      .update(e)
      .set({ name, updatedAt: new Date() })
      .where(eq(e.id, id))
      .returning();
    if (!row) throw ManabloxError.notFound('environment.notFound', { id });
    return row;
  }

  /** Deletes a staging environment and its rows; production is never deleted. */
  delete(id: string): Promise<boolean> {
    const { spaceEnvironments: e } = this.t;
    return this.removeWhere(e, and(eq(e.id, id), ne(e.kind, 'production')));
  }
}
