import { ManabloxError } from '@manablox/core';
import {
  and,
  asc,
  desc,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import { batches } from '../batch.js';
import type { ControlEventRow } from '../schema/index.js';
import { Repository } from './base.js';
import { type ControlScopeKey, scopeIdOf } from './control-setting.js';

export interface ControlEventInput {
  type: string;
  scope: ControlScopeKey;
  payload?: Record<string, unknown> | undefined;
}

/**
 * Outbox of events for the external layer. Append inside the transaction of the cause
 * (`repos.transaction`); a lock held until commit keeps `seq` in commit order.
 */
export class ControlEventRepository extends Repository {
  async append(input: ControlEventInput): Promise<ControlEventRow> {
    const [row] = await this.appendMany([input]);
    if (!row) throw new ManabloxError('internal.error');
    return row;
  }

  /** Appends events in order. */
  async appendMany(inputs: readonly ControlEventInput[]): Promise<ControlEventRow[]> {
    if (inputs.length === 0) return [];
    const { controlEvents } = this.t;
    return this.db.transaction(async (tx) => {
      await this.dialect.lockInTransaction(tx, 'control_events');
      // SQLite's `seq` default reads the maximum once per statement, so a batch numbers itself.
      let next = 0;
      if (this.dialect.name === 'sqlite') {
        const [last] = await tx
          .select({ seq: controlEvents.seq })
          .from(controlEvents)
          .orderBy(desc(controlEvents.seq))
          .limit(1);
        next = last?.seq ?? 0;
      }
      const now = new Date();
      const values = inputs.map((input) => ({
        type: input.type,
        scopeKind: input.scope.kind,
        scopeId: scopeIdOf(input.scope),
        payload: input.payload ?? {},
        createdAt: now,
        ...(this.dialect.name === 'sqlite' ? { seq: ++next } : {}),
      }));
      const rows: ControlEventRow[] = [];
      for (const batch of batches(values, 7, this.dialect.maxParameters)) {
        rows.push(...(await tx.insert(controlEvents).values(batch).returning()));
      }
      return rows.sort((a, b) => a.seq - b.seq);
    });
  }

  /** Events after `seq`, oldest first, for pull. */
  listAfter(seq: number, limit: number): Promise<ControlEventRow[]> {
    const { controlEvents } = this.t;
    return this.db
      .select()
      .from(controlEvents)
      .where(gt(controlEvents.seq, seq))
      .orderBy(asc(controlEvents.seq))
      .limit(limit);
  }

  /** Events not delivered yet, oldest first; `maxAttempts` skips those that used them up. */
  listUndelivered(limit: number, maxAttempts?: number): Promise<ControlEventRow[]> {
    const { controlEvents } = this.t;
    return this.db
      .select()
      .from(controlEvents)
      .where(
        and(
          isNull(controlEvents.deliveredAt),
          ...(maxAttempts !== undefined ? [lt(controlEvents.attempts, maxAttempts)] : []),
        ),
      )
      .orderBy(asc(controlEvents.seq))
      .limit(limit);
  }

  /** The highest `seq`, 0 when empty. */
  async latestSeq(): Promise<number> {
    const { controlEvents } = this.t;
    const [row] = await this.db
      .select({ seq: controlEvents.seq })
      .from(controlEvents)
      .orderBy(desc(controlEvents.seq))
      .limit(1);
    return row?.seq ?? 0;
  }

  async markDelivered(ids: readonly string[], at: Date = new Date()): Promise<void> {
    const { controlEvents } = this.t;
    await this.eachBatch(ids, (batch) =>
      this.db
        .update(controlEvents)
        .set({ deliveredAt: at })
        .where(and(inArray(controlEvents.id, batch), isNull(controlEvents.deliveredAt))),
    );
  }

  async incrementAttempts(ids: readonly string[]): Promise<void> {
    const { controlEvents } = this.t;
    await this.eachBatch(ids, (batch) =>
      this.db
        .update(controlEvents)
        .set({ attempts: sql`${controlEvents.attempts} + 1` })
        .where(inArray(controlEvents.id, batch)),
    );
  }

  /**
   * Deletes events created before `before`; `deliveredOnly` keeps undelivered ones. The
   * latest event stays, so SQLite never numbers a new one below a pulled `seq`.
   */
  async pruneBefore(before: Date, options: { deliveredOnly?: boolean } = {}): Promise<number> {
    const { controlEvents } = this.t;
    const latest = await this.latestSeq();
    const where: SQL | undefined = and(
      lte(controlEvents.createdAt, before),
      lt(controlEvents.seq, latest),
      ...(options.deliveredOnly ? [isNotNull(controlEvents.deliveredAt)] : []),
    );
    const rows = await this.db
      .delete(controlEvents)
      .where(where)
      .returning({ id: controlEvents.id });
    return rows.length;
  }

  private async eachBatch(
    ids: readonly string[],
    fn: (batch: string[]) => PromiseLike<unknown>,
  ): Promise<void> {
    for (const batch of batches([...new Set(ids)], 1, this.dialect.maxParameters)) {
      await fn(batch);
    }
  }
}
