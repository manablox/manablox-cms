import { and, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { batches } from '../batch.js';
import type { UsageCounterRow } from '../schema/index.js';
import { Repository } from './base.js';
import { type ControlScopeKey, scopeIdOf } from './control-setting.js';

/** One counter: a scope's metric in a period. */
export interface UsageCounterKey {
  scope: ControlScopeKey;
  metric: string;
  period: string;
}

export interface UsageDelta extends UsageCounterKey {
  delta: number;
}

/** Spaces to sum over; `all` is every space counter. */
export type UsageSpaces = readonly string[] | 'all';

/** Usage counters; space rows are primary, group and instance totals are sums of them. */
export class UsageCounterRepository extends Repository {
  /** Adds each delta to its counter, creating it at the delta. */
  async incrementMany(deltas: readonly UsageDelta[]): Promise<void> {
    const { usageCounters } = this.t;
    // Merged first: ON CONFLICT DO UPDATE refuses a key twice in one statement.
    const merged = new Map<string, Omit<UsageCounterRow, 'updatedAt'>>();
    for (const entry of deltas) {
      if (entry.delta === 0) continue;
      const scopeId = scopeIdOf(entry.scope);
      const key = JSON.stringify([entry.scope.kind, scopeId, entry.metric, entry.period]);
      const seen = merged.get(key);
      if (seen) seen.value += entry.delta;
      else {
        merged.set(key, {
          scopeKind: entry.scope.kind,
          scopeId,
          metric: entry.metric,
          period: entry.period,
          value: entry.delta,
        });
      }
    }
    const now = new Date();
    for (const batch of batches([...merged.values()], 6, this.dialect.maxParameters)) {
      await this.db
        .insert(usageCounters)
        .values(batch.map((row) => ({ ...row, updatedAt: now })))
        .onConflictDoUpdate({
          target: [
            usageCounters.scopeKind,
            usageCounters.scopeId,
            usageCounters.metric,
            usageCounters.period,
          ],
          set: { value: sql`${usageCounters.value} + excluded.value`, updatedAt: now },
        });
    }
  }

  /**
   * Adds a flushed batch once: records `flushId` and adds the deltas; false, adding nothing,
   * when the id was recorded before. Run it in a transaction.
   */
  async incrementOnce(
    flushId: string,
    deltas: readonly UsageDelta[],
    at: Date = new Date(),
  ): Promise<boolean> {
    const { usageFlushes } = this.t;
    const claimed = await this.db
      .insert(usageFlushes)
      .values({ id: flushId, flushedAt: at })
      .onConflictDoNothing({ target: usageFlushes.id })
      .returning({ id: usageFlushes.id });
    if (claimed.length === 0) return false;
    await this.incrementMany(deltas);
    return true;
  }

  /** Forgets flush ids recorded before `before`. */
  async pruneFlushes(before: Date): Promise<void> {
    const { usageFlushes } = this.t;
    await this.db.delete(usageFlushes).where(lt(usageFlushes.flushedAt, before));
  }

  increment(key: UsageCounterKey, delta: number): Promise<void> {
    return this.incrementMany([{ ...key, delta }]);
  }

  /** Sets a counter, e.g. after reconciling it with a count. */
  async set(key: UsageCounterKey, value: number): Promise<void> {
    const { usageCounters } = this.t;
    const now = new Date();
    await this.db
      .insert(usageCounters)
      .values({
        scopeKind: key.scope.kind,
        scopeId: scopeIdOf(key.scope),
        metric: key.metric,
        period: key.period,
        value,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          usageCounters.scopeKind,
          usageCounters.scopeId,
          usageCounters.metric,
          usageCounters.period,
        ],
        set: { value, updatedAt: now },
      });
  }

  /** A counter's value; 0 when it has none. */
  async get(key: UsageCounterKey): Promise<number> {
    const { usageCounters } = this.t;
    const [row] = await this.db
      .select({ value: usageCounters.value })
      .from(usageCounters)
      .where(
        and(
          this.inScope(key.scope),
          eq(usageCounters.metric, key.metric),
          eq(usageCounters.period, key.period),
        ),
      )
      .limit(1);
    return row ? Number(row.value) : 0;
  }

  /** A scope's counters of a period. */
  async listForScope(scope: ControlScopeKey, period: string): Promise<UsageCounterRow[]> {
    const { usageCounters } = this.t;
    return this.db
      .select()
      .from(usageCounters)
      .where(and(this.inScope(scope), eq(usageCounters.period, period)))
      .orderBy(usageCounters.metric);
  }

  /** The sum of one metric over space counters. */
  async sumForSpaces(metric: string, period: string, spaceIds: UsageSpaces): Promise<number> {
    return (await this.sumsForSpaces(period, spaceIds, [metric]))[metric] ?? 0;
  }

  /** Sums per metric over space counters; `metrics` limits the metrics read. */
  async sumsForSpaces(
    period: string,
    spaceIds: UsageSpaces,
    metrics?: readonly string[],
  ): Promise<Record<string, number>> {
    const { usageCounters } = this.t;
    const out: Record<string, number> = {};
    const add = async (where: SQL | undefined) => {
      const rows = await this.db
        .select({
          metric: usageCounters.metric,
          value: sql<number>`coalesce(sum(${usageCounters.value}), 0)`.mapWith(Number),
        })
        .from(usageCounters)
        .where(
          and(
            eq(usageCounters.scopeKind, 'space'),
            eq(usageCounters.period, period),
            ...(metrics ? [inArray(usageCounters.metric, [...metrics])] : []),
            where,
          ),
        )
        .groupBy(usageCounters.metric);
      for (const row of rows) out[row.metric] = (out[row.metric] ?? 0) + row.value;
    };
    if (spaceIds === 'all') await add(undefined);
    else {
      const unique = [...new Set(spaceIds)];
      const room = this.dialect.maxParameters - (metrics?.length ?? 0);
      for (const batch of batches(unique, 1, room)) {
        await add(inArray(usageCounters.scopeId, batch));
      }
    }
    return out;
  }

  /** Every space counter of a period; `metrics` limits the metrics read. */
  async listSpaces(
    period: string,
    metrics?: readonly string[],
  ): Promise<Array<{ spaceId: string; metric: string; value: number }>> {
    const { usageCounters } = this.t;
    return this.db
      .select({
        spaceId: usageCounters.scopeId,
        metric: usageCounters.metric,
        value: sql<number>`${usageCounters.value}`.mapWith(Number),
      })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.scopeKind, 'space'),
          eq(usageCounters.period, period),
          ...(metrics ? [inArray(usageCounters.metric, [...metrics])] : []),
        ),
      );
  }

  /** Removes a scope's counters, e.g. when its space is deleted. */
  async deleteScope(scope: ControlScopeKey): Promise<boolean> {
    return this.removeWhere(this.t.usageCounters, this.inScope(scope));
  }

  private inScope(scope: ControlScopeKey): SQL {
    const { usageCounters } = this.t;
    return and(
      eq(usageCounters.scopeKind, scope.kind),
      eq(usageCounters.scopeId, scopeIdOf(scope)),
    ) as SQL;
  }
}
