import { and, eq, gte, inArray, max, type SQL, sql } from 'drizzle-orm';
import { batches } from '../batch.js';
import type { UsageExternalMode } from '../definitions/controls.js';
import type { UsageExternalRow } from '../schema/index.js';
import { Repository } from './base.js';

export interface UsageExternalInput {
  idempotencyKey: string;
  spaceId: string;
  metric: string;
  period: string;
  value: number;
  mode: UsageExternalMode;
}

/** The external figure of a space's metric in a period. */
export interface UsageExternalTotal {
  spaceId: string;
  metric: string;
  period: string;
  value: number;
}

export interface UsageExternalFilter {
  period: string;
  metric?: string | undefined;
  spaceIds?: readonly string[] | undefined;
}

/**
 * Usage figures reported by the external layer. A space's external figure for a metric and
 * period is its latest `set` plus every `add` received after it.
 */
export class UsageExternalRepository extends Repository {
  /** Stores a report once per idempotency key; false when the key was seen before. */
  async insert(input: UsageExternalInput): Promise<boolean> {
    const { usageExternal } = this.t;
    const rows = await this.db
      .insert(usageExternal)
      .values(input)
      .onConflictDoNothing({ target: usageExternal.idempotencyKey })
      .returning({ key: usageExternal.idempotencyKey });
    return rows.length > 0;
  }

  findByKey(idempotencyKey: string): Promise<UsageExternalRow | null> {
    const { usageExternal } = this.t;
    return this.findOneWhere(usageExternal, eq(usageExternal.idempotencyKey, idempotencyKey));
  }

  /** The external figure of one space, metric and period; 0 without reports. */
  async total(spaceId: string, metric: string, period: string): Promise<number> {
    const [row] = await this.totals({ period, metric, spaceIds: [spaceId] });
    return row?.value ?? 0;
  }

  /** External figures per space and metric of a period. */
  async totals(filter: UsageExternalFilter): Promise<UsageExternalTotal[]> {
    if (!filter.spaceIds) return this.totalsWhere(filter, undefined);
    const out: UsageExternalTotal[] = [];
    for (const batch of batches([...new Set(filter.spaceIds)], 2, this.dialect.maxParameters)) {
      out.push(...(await this.totalsWhere(filter, batch)));
    }
    return out;
  }

  private async totalsWhere(
    filter: UsageExternalFilter,
    spaceIds: string[] | undefined,
  ): Promise<UsageExternalTotal[]> {
    const { usageExternal: e } = this.t;
    const scope = (): SQL | undefined =>
      and(
        eq(e.period, filter.period),
        ...(filter.metric ? [eq(e.metric, filter.metric)] : []),
        ...(spaceIds ? [inArray(e.spaceId, spaceIds)] : []),
      );
    const lastSet = this.db
      .select({
        spaceId: e.spaceId,
        metric: e.metric,
        period: e.period,
        seq: max(e.seq).as('last_seq'),
      })
      .from(e)
      .where(and(eq(e.mode, 'set'), scope()))
      .groupBy(e.spaceId, e.metric, e.period)
      .as('last_set');
    // Rows before the latest `set` are replaced by it.
    const since = sql`coalesce(${lastSet.seq}, 0)`;
    const rows = await this.db
      .select({
        spaceId: e.spaceId,
        metric: e.metric,
        period: e.period,
        value: sql<number>`coalesce(sum(${e.value}), 0)`.mapWith(Number),
      })
      .from(e)
      .leftJoin(
        lastSet,
        and(
          eq(lastSet.spaceId, e.spaceId),
          eq(lastSet.metric, e.metric),
          eq(lastSet.period, e.period),
        ),
      )
      .where(and(scope(), gte(e.seq, since), sql`(${e.mode} = 'add' or ${e.seq} = ${since})`))
      .groupBy(e.spaceId, e.metric, e.period)
      .orderBy(e.spaceId, e.metric);
    return rows;
  }
}
