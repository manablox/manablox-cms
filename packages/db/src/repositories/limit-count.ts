import type { ContentTypeKind, ContentTypeRegistry } from '@manablox/core';
import {
  and,
  count,
  countDistinct,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Tables } from '../tables.js';
import type { DatabaseContext } from './base.js';
import { inProduction, Repository } from './base.js';
import type { UsageSpaces } from './usage-counter.js';
import { UsageCounterRepository } from './usage-counter.js';

/** The period of counters kept for count limits. */
export const TOTAL_PERIOD = 'total';

/** Count limits kept as `total` usage counters, updated with every write. */
export type TotalMetric = 'documents' | 'databagEntries' | 'storageBytes';

export const TOTAL_METRICS: readonly TotalMetric[] = [
  'documents',
  'databagEntries',
  'storageBytes',
];

/** The counter a document of `kind` adds to; `null` for none. */
export function documentMetric(kind: ContentTypeKind | undefined): TotalMetric | null {
  if (kind === 'content') return 'documents';
  if (kind === 'data') return 'databagEntries';
  return null;
}

/** Adds `delta` to space counters; run on the write's executor so it commits with it. */
export async function addTotals(
  context: DatabaseContext,
  deltas: ReadonlyArray<{ spaceId: string; metric: TotalMetric; delta: number }>,
): Promise<void> {
  if (!deltas.some((entry) => entry.delta !== 0)) return;
  await new UsageCounterRepository(context).incrementMany(
    deltas.map((entry) => ({
      scope: { kind: 'space', id: entry.spaceId },
      metric: entry.metric,
      period: TOTAL_PERIOD,
      delta: entry.delta,
    })),
  );
}

/** Counts behind count limits, and the true values of the `total` counters; staging rows never count. */
export class LimitCountRepository extends Repository {
  constructor(
    context: DatabaseContext,
    private readonly registry: ContentTypeRegistry,
  ) {
    super(context);
  }

  spaces(): Promise<number> {
    return this.countWhere(this.t.spaces, undefined);
  }

  /** Accounts with a membership in the spaces; every account for `all`. */
  async seats(spaceIds: UsageSpaces): Promise<number> {
    if (spaceIds === 'all') return this.countWhere(this.t.users, undefined);
    if (spaceIds.length === 0) return 0;
    const { memberships } = this.t;
    const [row] = await this.db
      .select({ value: countDistinct(memberships.userId) })
      .from(memberships)
      .where(inArray(memberships.spaceId, [...spaceIds]));
    return row?.value ?? 0;
  }

  /** Of `userIds`, those without a membership in any of the spaces. */
  async usersOutside(spaceIds: readonly string[], userIds: readonly string[]): Promise<number> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0 || spaceIds.length === 0) return unique.length;
    const { memberships } = this.t;
    const rows = await this.db
      .selectDistinct({ userId: memberships.userId })
      .from(memberships)
      .where(and(inArray(memberships.spaceId, [...spaceIds]), inArray(memberships.userId, unique)));
    return unique.length - rows.length;
  }

  /** Space-owned types of the kinds. */
  contentTypes(spaceIds: UsageSpaces, kinds: readonly ContentTypeKind[]): Promise<number> {
    const { contentTypes } = this.t;
    return this.countWhere(
      contentTypes,
      and(
        inArray(contentTypes.kind, [...kinds]),
        this.inSpaces(contentTypes.spaceId, spaceIds),
        inProduction(this.t, contentTypes),
      ),
    );
  }

  menus(spaceIds: UsageSpaces): Promise<number> {
    const { menus } = this.t;
    return this.countWhere(
      menus,
      and(this.inSpaces(menus.spaceId, spaceIds), inProduction(this.t, menus)),
    );
  }

  apiHosts(spaceIds: UsageSpaces): Promise<number> {
    const { spaceApiHosts } = this.t;
    return this.countWhere(
      spaceApiHosts,
      and(this.inSpaces(spaceApiHosts.spaceId, spaceIds), inProduction(this.t, spaceApiHosts)),
    );
  }

  /** Manual redirects; automatic ones follow slug changes. */
  manualRedirects(spaceIds: UsageSpaces): Promise<number> {
    const { redirects } = this.t;
    return this.countWhere(
      redirects,
      and(
        eq(redirects.source, 'manual'),
        this.inSpaces(redirects.spaceId, spaceIds),
        inProduction(this.t, redirects),
      ),
    );
  }

  customRoles(spaceIds: UsageSpaces): Promise<number> {
    const { roles } = this.t;
    return this.countWhere(roles, this.inSpaces(roles.spaceId, spaceIds));
  }

  /** Keys that still work or may again: expired ones are left out. */
  apiKeys(): Promise<number> {
    const { apikeys } = this.t;
    return this.countWhere(
      apikeys,
      or(isNull(apikeys.expiresAt), gt(apikeys.expiresAt, new Date())),
    );
  }

  /** The true value of each `total` counter per space, from the rows themselves. */
  async totals(): Promise<Map<string, Record<TotalMetric, number>>> {
    const out = new Map<string, Record<TotalMetric, number>>();
    const put = (spaceId: string, metric: TotalMetric, value: number) => {
      const entry = out.get(spaceId) ?? { documents: 0, databagEntries: 0, storageBytes: 0 };
      entry[metric] += value;
      out.set(spaceId, entry);
    };
    for (const space of await this.db.select({ id: this.t.spaces.id }).from(this.t.spaces)) {
      out.set(space.id, { documents: 0, databagEntries: 0, storageBytes: 0 });
    }

    const { contents } = this.t;
    const perType = await this.db
      .select({ spaceId: contents.spaceId, typeId: contents.typeId, value: count() })
      .from(contents)
      .where(inProduction(this.t, contents))
      .groupBy(contents.spaceId, contents.typeId);
    for (const row of perType) {
      const metric = documentMetric(this.registry.tryGet(row.typeId)?.kind);
      if (metric) put(row.spaceId, metric, row.value);
    }

    const { assets, assetSpaces, assetVariants } = this.t;
    const variants = this.db
      .select({
        assetId: assetVariants.assetId,
        size: sql<number>`sum(${assetVariants.size})`.as('variant_size'),
      })
      .from(assetVariants)
      .groupBy(assetVariants.assetId)
      .as('variant_sizes');
    const storage = await this.db
      .select({
        spaceId: assetSpaces.spaceId,
        value:
          sql<number>`coalesce(sum(${assets.size} + coalesce(${variants.size}, 0)), 0)`.mapWith(
            Number,
          ),
      })
      .from(assets)
      .innerJoin(
        assetSpaces,
        and(eq(assetSpaces.assetId, assets.id), eq(assetSpaces.spaceId, ownerOf(this.t))),
      )
      .leftJoin(variants, eq(variants.assetId, assets.id))
      .groupBy(assetSpaces.spaceId);
    for (const row of storage) put(row.spaceId, 'storageBytes', row.value);
    return out;
  }

  /** The stored `total` counters per space. */
  async storedTotals(): Promise<Map<string, Partial<Record<TotalMetric, number>>>> {
    const { usageCounters } = this.t;
    const rows = await this.db
      .select({
        spaceId: usageCounters.scopeId,
        metric: usageCounters.metric,
        value: usageCounters.value,
      })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.scopeKind, 'space'),
          eq(usageCounters.period, TOTAL_PERIOD),
          inArray(usageCounters.metric, [...TOTAL_METRICS]),
        ),
      );
    const out = new Map<string, Partial<Record<TotalMetric, number>>>();
    for (const row of rows) {
      out.set(row.spaceId, { ...out.get(row.spaceId), [row.metric]: Number(row.value) });
    }
    return out;
  }

  private async countWhere(table: PgTable, where: SQL | undefined): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(table).where(where);
    return row?.value ?? 0;
  }

  /** `all` is every space-owned row. */
  private inSpaces(column: PgColumn, spaceIds: UsageSpaces): SQL {
    if (spaceIds === 'all') return isNotNull(column);
    if (spaceIds.length === 0) return sql`1 = 0`;
    return inArray(column, [...spaceIds]);
  }
}

/**
 * The space an asset row's bytes count in: its first `asset_spaces` row by creation, then
 * space id. `AssetRepository` picks the owner the same way.
 */
function ownerOf(tables: Tables): SQL {
  const assetId = sql`${sql.identifier('assets')}.${sql.identifier('id')}`;
  return sql`(select owner.space_id from ${tables.assetSpaces} owner where owner.asset_id = ${assetId} order by owner.created_at, owner.space_id limit 1)`;
}
