import {
  type AuditAction,
  type AuditActor,
  type AuditActorKind,
  type AuditChange,
  type AuditSortField,
  type AuditTargetKind,
  ManabloxError,
} from '@manablox/core';
import { currentActor, hashAuditEntry } from '@manablox/core/node';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { batches } from '../batch.js';
import type { Executor } from '../client.js';
import { type Dialect, escapeLike } from '../dialect.js';
import {
  AUDIT_COUNT_CAP,
  AUDIT_VERIFY_BATCH,
  firstPage,
  type Paginated,
  paginate,
} from '../pagination.js';
import type { Pagination } from '../query.js';
import type { AuditEntryRow } from '../schema/index.js';
import type { Tables } from '../tables.js';
import { type DatabaseContext, Repository } from './base.js';

export interface AuditAppendInput {
  /** The space the action concerns; omit for an instance-wide action. */
  spaceId?: string | null | undefined;
  /** Who did it; the current actor (see `runAsActor`) when omitted. */
  actor?: AuditActor | undefined;
  action: AuditAction;
  targetKind: AuditTargetKind;
  targetId?: string | null | undefined;
  targetLabel?: string | null | undefined;
  changes?: AuditChange[] | undefined;
  meta?: Record<string, unknown> | null | undefined;
  at?: Date | undefined;
}

export interface AuditFilter {
  /** `null` for instance-wide entries only; absent for all. */
  spaceId?: string | null | undefined;
  actorKind?: AuditActorKind | undefined;
  actorId?: string | undefined;
  actions?: AuditAction[] | undefined;
  targetKind?: AuditTargetKind | undefined;
  targetId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Matches actor label, target label and action. */
  search?: string | undefined;
  /** Leaves out entries older than their scope's retention window. */
  retention?: AuditRetention | undefined;
}

/** Retention cutoffs; `null` keeps everything. */
export interface AuditRetention {
  /** Instance entries, and spaces not in `spaces`. */
  instance: Date | null;
  /** Spaces whose cutoff differs from the instance's. */
  spaces?: ReadonlyMap<string, Date | null> | undefined;
}

export interface AuditPruneOptions {
  /** The space whose entries go; `null` for instance entries. */
  spaceId: string | null;
  before: Date;
  limit: number;
  /** Runs before anything is deleted; a throw deletes nothing. */
  beforeDelete?: ((rows: AuditEntryRow[]) => Promise<void>) | undefined;
}

export interface AuditPruneResult {
  count: number;
  /** The `audit.pruned` entry the chain verification restarts at. */
  anchor: AuditEntryRow;
}

/** What an `audit.pruned` anchor notes in `meta`. */
export interface AuditPruneAnchor {
  count: number;
  fromSeq: number;
  toSeq: number;
  from: string;
  to: string;
  /** Hash of the newest pruned entry. */
  lastHash: string;
  /** Hashes of pruned entries a remaining entry (or this anchor) links to. */
  bridges: string[];
}

export const AUDIT_PRUNED_ACTION = 'audit.pruned';

export interface AuditSort {
  by: AuditSortField;
  direction: 'asc' | 'desc';
}

export interface AuditVerification {
  ok: boolean;
  checked: number;
  /** First entry with a bad hash or a broken `prevHash` link. */
  brokenAt: { seq: number; id: string; reason: 'hash' | 'link' } | null;
}

export interface AuditRepositoryOptions {
  /** Called when `record` fails to write. */
  onError?: ((error: unknown, input: AuditAppendInput) => void) | undefined;
  /** Called after commit; a throw goes to `onError`. */
  onAppended?: ((row: AuditEntryRow) => void) | undefined;
}

/** Bound parameters per inserted entry, with room for defaults. */
const AUDIT_COLUMNS = 16;

const sortColumn = (auditEntries: Tables['auditEntries'], by: AuditSortField) =>
  ({
    at: auditEntries.at,
    action: auditEntries.action,
    actorLabel: auditEntries.actorLabel,
    targetKind: auditEntries.targetKind,
    targetLabel: auditEntries.targetLabel,
  })[by];

/** Actor and time taken when the entry is recorded, not when it is written. */
function stamped(input: AuditAppendInput): AuditAppendInput {
  return { ...input, actor: input.actor ?? currentActor(), at: input.at ?? new Date() };
}

/** Append-only audit log. */
export class AuditRepository extends Repository {
  constructor(
    context: DatabaseContext,
    private readonly options: AuditRepositoryOptions = {},
  ) {
    super(context);
  }

  /** Writes one entry chained to the last; a lock serialises writers. */
  async append(input: AuditAppendInput): Promise<AuditEntryRow> {
    const [row] = await this.appendMany([input]);
    if (!row) throw new ManabloxError('audit.append.failed');
    return row;
  }

  /** Writes entries in order under one lock, each chained to the one before. */
  async appendMany(inputs: readonly AuditAppendInput[]): Promise<AuditEntryRow[]> {
    if (inputs.length === 0) return [];
    const rows = await this.write(inputs);
    const { onAppended, onError } = this.options;
    if (onAppended) {
      this.afterCommit(() => {
        rows.forEach((row, index) => {
          try {
            onAppended(row);
          } catch (error) {
            onError?.(error, inputs[index] as AuditAppendInput);
          }
        });
      });
    }
    return rows;
  }

  private write(inputs: readonly AuditAppendInput[]): Promise<AuditEntryRow[]> {
    return this.db.transaction(async (tx) => {
      await this.dialect.lockInTransaction(tx, 'audit_entries');
      return this.writeIn(tx, inputs);
    });
  }

  /** Appends under the chain lock the caller holds. */
  private async writeIn(
    tx: Executor,
    inputs: readonly AuditAppendInput[],
  ): Promise<AuditEntryRow[]> {
    const fallback = currentActor();
    const { auditEntries } = this.t;
    const [last] = await tx
      .select({ hash: auditEntries.hash, seq: auditEntries.seq })
      .from(auditEntries)
      .orderBy(desc(auditEntries.seq))
      .limit(1);
    let prevHash = last?.hash ?? null;
    // SQLite's `seq` default reads the maximum once per statement, so a batch numbers itself.
    const lastSeq = last?.seq ?? 0;
    const seqOf = (index: number) =>
      this.dialect.name === 'sqlite' ? { seq: lastSeq + index + 1 } : {};

    const values = inputs.map((input, index) => {
      const actor = input.actor ?? fallback;
      const content = {
        at: input.at ?? new Date(),
        spaceId: input.spaceId ?? null,
        actorKind: actor.kind,
        actorId: actor.id,
        actorLabel: actor.label,
        actorDetail: actor.detail ?? null,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        changes: input.changes ?? [],
        meta: input.meta ?? null,
        prevHash,
      };
      const hash = hashAuditEntry(content);
      prevHash = hash;
      return { ...content, hash, ...seqOf(index) };
    });

    const rows: AuditEntryRow[] = [];
    for (const batch of batches(values, AUDIT_COLUMNS, this.dialect.maxParameters)) {
      rows.push(...(await tx.insert(auditEntries).values(batch).returning()));
    }
    rows.sort((a, b) => a.seq - b.seq);
    // `seq` must follow the chain, or `verify` would report a broken link.
    if (rows.length !== values.length || rows.some((row, i) => row.hash !== values[i]?.hash)) {
      throw new ManabloxError('audit.append.failed');
    }
    return rows;
  }

  /**
   * Deletes up to `limit` of a scope's entries older than `before`, oldest first, after
   * appending an `audit.pruned` anchor; `null` when none are due. Anchors are never pruned.
   */
  async prune(options: AuditPruneOptions): Promise<AuditPruneResult | null> {
    const { auditEntries } = this.t;
    const rows: AuditEntryRow[] = await this.db
      .select()
      .from(auditEntries)
      .where(
        and(
          options.spaceId === null
            ? isNull(auditEntries.spaceId)
            : eq(auditEntries.spaceId, options.spaceId),
          lt(auditEntries.at, options.before),
          ne(auditEntries.action, AUDIT_PRUNED_ACTION),
        ),
      )
      .orderBy(asc(auditEntries.seq))
      .limit(options.limit);
    const first = rows[0];
    const last = rows.at(-1);
    if (!first || !last) return null;
    await options.beforeDelete?.(rows);

    const ids = rows.map((row) => row.id);
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
    const anchor = await this.db.transaction(async (tx) => {
      await this.dialect.lockInTransaction(tx, 'audit_entries');
      // The entry after each pruned one; the anchor follows the newest.
      const next = await this.dialect.rows<{
        hash: string;
        next_id: string | null;
        next_prev: string | null;
      }>(
        tx,
        sql`select d.hash as hash,
          (select n.id from audit_entries n where n.seq > d.seq order by n.seq limit 1) as next_id,
          (select n.prev_hash from audit_entries n where n.seq > d.seq order by n.seq limit 1) as next_prev
        from audit_entries d where d.id in (${idList})`,
      );
      if (next.length !== ids.length) throw new ManabloxError('internal.error');
      const pruned = new Set(ids);
      const bridges = next
        .filter(
          (entry) =>
            entry.next_id === null ||
            (!pruned.has(entry.next_id) && entry.next_prev === entry.hash),
        )
        .map((entry) => entry.hash);
      const meta: AuditPruneAnchor = {
        count: rows.length,
        fromSeq: first.seq,
        toSeq: last.seq,
        from: first.at.toISOString(),
        to: last.at.toISOString(),
        lastHash: last.hash,
        bridges,
      };
      const [written] = await this.writeIn(tx, [
        {
          spaceId: options.spaceId,
          action: AUDIT_PRUNED_ACTION,
          targetKind: 'audit',
          meta: { ...meta },
        },
      ]);
      if (!written) throw new ManabloxError('audit.append.failed');
      const removed = await this.deleteGuarded(tx, idList);
      if (removed !== ids.length) throw new ManabloxError('internal.error');
      return written;
    });
    const { onAppended, onError } = this.options;
    if (onAppended) {
      this.afterCommit(() => {
        try {
          onAppended(anchor);
        } catch (error) {
          onError?.(error, { action: AUDIT_PRUNED_ACTION, targetKind: 'audit' });
        }
      });
    }
    return { count: ids.length, anchor };
  }

  /** The only delete the immutability triggers let through. */
  private async deleteGuarded(tx: Executor, idList: SQL): Promise<number> {
    if (this.dialect.name === 'postgres') {
      const [row] = await this.dialect.rows<{ removed: number | string }>(
        tx,
        sql`select audit_entries_prune(array[${idList}]::uuid[]) as removed`,
      );
      return Number(row?.removed ?? 0);
    }
    await this.dialect.run(tx, sql`update audit_prune_guard set active = 1 where id = 1`);
    const removed = await this.dialect.rows(
      tx,
      sql`delete from audit_entries where id in (${idList}) returning 1 as one`,
    );
    await this.dialect.run(tx, sql`update audit_prune_guard set active = 0 where id = 1`);
    return removed.length;
  }

  /**
   * `append` that never throws; failures go to `onError`. Inside a transaction the entry is
   * queued, written right before commit so the chain lock is held briefly, and `null` returned.
   */
  async record(input: AuditAppendInput): Promise<AuditEntryRow | null> {
    if (this.unit) {
      this.unit.appendAudit(stamped(input));
      return null;
    }
    try {
      return await this.append(input);
    } catch (error) {
      this.options.onError?.(error, input);
      return null;
    }
  }

  /** `appendMany` that never throws; inside a transaction queued like `record`, returning `[]`. */
  async recordMany(inputs: readonly AuditAppendInput[]): Promise<AuditEntryRow[]> {
    if (this.unit) {
      for (const input of inputs) this.unit.appendAudit(stamped(input));
      return [];
    }
    return this.recordNow(inputs);
  }

  /** `appendMany` that never throws, written now even inside a transaction. */
  async recordNow(inputs: readonly AuditAppendInput[]): Promise<AuditEntryRow[]> {
    try {
      return await this.appendMany(inputs);
    } catch (error) {
      if (inputs[0]) this.options.onError?.(error, inputs[0]);
      return [];
    }
  }

  findById(id: string): Promise<AuditEntryRow | null> {
    return this.findOne(this.t.auditEntries, id);
  }

  page(
    filter: AuditFilter,
    sort: AuditSort = { by: 'at', direction: 'desc' },
    pagination: Pagination = { limit: 50, offset: 0 },
  ): Promise<Paginated<AuditEntryRow>> {
    const { auditEntries } = this.t;
    const column = sortColumn(auditEntries, sort.by);
    const primary = sort.direction === 'asc' ? asc(column) : desc(column);
    // `seq` breaks ties for stable paging.
    const tiebreak = sort.direction === 'asc' ? asc(auditEntries.seq) : desc(auditEntries.seq);
    // The biggest table: the total stops counting at a cap, see `AUDIT_COUNT_CAP`.
    return paginate(this.db, auditEntries, {
      where: buildWhere(auditEntries, this.dialect, filter),
      orderBy: [primary, tiebreak],
      pagination,
      countCap: AUDIT_COUNT_CAP,
    });
  }

  /** A page of entries about one target, newest first. */
  pageByTarget(
    target: { kind: AuditTargetKind; id: string; spaceId?: string | undefined },
    pagination: Pagination = firstPage(),
    retention?: AuditRetention,
  ): Promise<Paginated<AuditEntryRow>> {
    const { auditEntries } = this.t;
    return this.paginate(
      auditEntries,
      and(
        eq(auditEntries.targetKind, target.kind),
        eq(auditEntries.targetId, target.id),
        target.spaceId === undefined ? undefined : eq(auditEntries.spaceId, target.spaceId),
        retention && retentionWhere(auditEntries, retention),
      ),
      desc(auditEntries.seq),
      pagination,
    );
  }

  /**
   * Recomputes every hash and checks every link across the whole chain. A link to a pruned
   * entry passes when a later `audit.pruned` anchor lists its hash.
   */
  async verify(batchSize = AUDIT_VERIFY_BATCH): Promise<AuditVerification> {
    const { auditEntries } = this.t;
    const bridges = await this.prunedBridges();
    let prevHash: string | null = null;
    let afterSeq = 0;
    let checked = 0;
    for (;;) {
      const rows: AuditEntryRow[] = await this.db
        .select()
        .from(auditEntries)
        .where(gt(auditEntries.seq, afterSeq))
        .orderBy(asc(auditEntries.seq))
        .limit(batchSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        checked++;
        const bridgedAt = row.prevHash === null ? undefined : bridges.get(row.prevHash);
        if (row.prevHash !== prevHash && !(bridgedAt !== undefined && bridgedAt >= row.seq)) {
          return { ok: false, checked, brokenAt: { seq: row.seq, id: row.id, reason: 'link' } };
        }
        const expected = hashAuditEntry({
          at: row.at,
          spaceId: row.spaceId,
          actorKind: row.actorKind,
          actorId: row.actorId,
          actorLabel: row.actorLabel,
          actorDetail: row.actorDetail,
          action: row.action,
          targetKind: row.targetKind,
          targetId: row.targetId,
          targetLabel: row.targetLabel,
          changes: row.changes,
          meta: row.meta,
          prevHash: row.prevHash,
        });
        if (expected !== row.hash) {
          return { ok: false, checked, brokenAt: { seq: row.seq, id: row.id, reason: 'hash' } };
        }
        prevHash = row.hash;
        afterSeq = row.seq;
      }
    }
    return { ok: true, checked, brokenAt: null };
  }

  /** Pruned hashes the anchors list, with the newest anchor's `seq`. */
  private async prunedBridges(): Promise<Map<string, number>> {
    const { auditEntries } = this.t;
    const anchors = await this.db
      .select({ seq: auditEntries.seq, meta: auditEntries.meta })
      .from(auditEntries)
      .where(eq(auditEntries.action, AUDIT_PRUNED_ACTION));
    const out = new Map<string, number>();
    for (const anchor of anchors) {
      const bridges = (anchor.meta as Partial<AuditPruneAnchor> | null)?.bridges;
      if (!Array.isArray(bridges)) continue;
      for (const hash of bridges) {
        if (typeof hash === 'string') out.set(hash, Math.max(out.get(hash) ?? 0, anchor.seq));
      }
    }
    return out;
  }

  async count(filter: AuditFilter = {}): Promise<number> {
    const { auditEntries } = this.t;
    const [row] = await this.db
      .select({ count: count() })
      .from(auditEntries)
      .where(buildWhere(auditEntries, this.dialect, filter));
    return row?.count ?? 0;
  }
}

function buildWhere(
  auditEntries: Tables['auditEntries'],
  dialect: Dialect,
  filter: AuditFilter,
): SQL | undefined {
  const conditions: SQL[] = [];
  if (filter.spaceId === null) conditions.push(isNull(auditEntries.spaceId));
  else if (filter.spaceId) conditions.push(eq(auditEntries.spaceId, filter.spaceId));
  if (filter.actorKind) conditions.push(eq(auditEntries.actorKind, filter.actorKind));
  if (filter.actorId) conditions.push(eq(auditEntries.actorId, filter.actorId));
  if (filter.actions?.length) conditions.push(inArray(auditEntries.action, filter.actions));
  if (filter.targetKind) conditions.push(eq(auditEntries.targetKind, filter.targetKind));
  if (filter.targetId) conditions.push(eq(auditEntries.targetId, filter.targetId));
  if (filter.from) conditions.push(gte(auditEntries.at, filter.from));
  if (filter.to) conditions.push(lte(auditEntries.at, filter.to));
  if (filter.search?.trim()) {
    const term = `%${escapeLike(filter.search.trim())}%`;
    const match = or(
      dialect.ilike(auditEntries.actorLabel, term),
      dialect.ilike(auditEntries.targetLabel, term),
      dialect.ilike(auditEntries.action, term),
    );
    if (match) conditions.push(match);
  }
  const kept = filter.retention && retentionWhere(auditEntries, filter.retention);
  if (kept) conditions.push(kept);
  return conditions.length ? and(...conditions) : undefined;
}

/** Entries inside their scope's window; `undefined` when every window keeps all. */
function retentionWhere(
  auditEntries: Tables['auditEntries'],
  retention: AuditRetention,
): SQL | undefined {
  const spaces = retention.spaces ?? new Map<string, Date | null>();
  const byCutoff = new Map<number | null, string[]>();
  for (const [spaceId, cutoff] of spaces) {
    const key = cutoff?.getTime() ?? null;
    byCutoff.set(key, [...(byCutoff.get(key) ?? []), spaceId]);
  }
  if (retention.instance === null && [...byCutoff.keys()].every((key) => key === null)) {
    return undefined;
  }
  const since = (time: number | null) =>
    time === null ? undefined : gte(auditEntries.at, new Date(time));
  const parts = [...byCutoff].map(([time, ids]) =>
    and(inArray(auditEntries.spaceId, ids), since(time)),
  );
  const listed = [...spaces.keys()];
  const rest =
    listed.length > 0
      ? or(isNull(auditEntries.spaceId), notInArray(auditEntries.spaceId, listed))
      : undefined;
  parts.push(and(rest, since(retention.instance?.getTime() ?? null)) ?? sql`1 = 1`);
  return or(...parts);
}
