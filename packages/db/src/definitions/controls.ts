import { sql } from 'drizzle-orm';
import {
  bigint,
  id,
  index,
  integer,
  json,
  primaryKey,
  serial,
  table,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from './define.js';
import { spaces } from './spaces.js';

export type ControlScopeKind = 'instance' | 'group' | 'space';

/** `add` adds to the external figure of its period; `set` replaces it. */
export type UsageExternalMode = 'add' | 'set';

/** The `scopeId` of instance rows, so uniques and keys hold in both dialects. */
const INSTANCE_SCOPE_ID = '';

/** A control value set by the external layer for one scope. */
export const controlSettings = table(
  'control_settings',
  {
    id: id(),
    scopeKind: text<ControlScopeKind>().notNull(),
    /** A group or space id; `''` for the instance. */
    scopeId: text().notNull().default(INSTANCE_SCOPE_ID),
    key: text().notNull(),
    value: json<unknown>().notNull(),
    updatedAt: timestamp().notNull().defaultNow(),
    updatedBy: text(),
  },
  (t) => [unique('control_settings_scope_key_key').on(t.scopeKind, t.scopeId, t.key)],
);

/** Internal instance state by key, never written through the control API's settings. */
export const instanceMeta = table(
  'instance_meta',
  {
    key: text().notNull(),
    value: json<unknown>().notNull(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey(t.key)],
);

/** A usage figure per scope, metric and period (`2026-10` or `total`); space rows are counted. */
export const usageCounters = table(
  'usage_counters',
  {
    scopeKind: text<ControlScopeKind>().notNull(),
    scopeId: text().notNull().default(INSTANCE_SCOPE_ID),
    metric: text().notNull(),
    period: text().notNull(),
    value: bigint().notNull().default(0),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey(t.scopeKind, t.scopeId, t.metric, t.period),
    index('usage_counters_metric_idx').on(t.scopeKind, t.metric, t.period),
  ],
);

/** A flushed usage batch, so a batch counted once is never counted again. */
export const usageFlushes = table(
  'usage_flushes',
  {
    id: text().notNull(),
    flushedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey(t.id), index('usage_flushes_flushed_idx').on(t.flushedAt)],
);

/** A usage figure reported by the external layer, kept once per idempotency key. */
export const usageExternal = table(
  'usage_external',
  {
    idempotencyKey: text().notNull(),
    /** Receipt order; the latest `set` replaces what came before it. */
    seq: serial(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    metric: text().notNull(),
    period: text().notNull(),
    value: bigint().notNull(),
    mode: text<UsageExternalMode>().notNull(),
    receivedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey(t.idempotencyKey),
    index('usage_external_space_metric_idx').on(t.spaceId, t.metric, t.period, t.seq),
  ],
);

/** Outbox of events for the external layer, pulled by `seq` or pushed. */
export const controlEvents = table(
  'control_events',
  {
    id: id(),
    seq: serial(),
    type: text().notNull(),
    scopeKind: text<ControlScopeKind>().notNull(),
    scopeId: text().notNull().default(INSTANCE_SCOPE_ID),
    payload: json<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp().notNull().defaultNow(),
    deliveredAt: timestamp(),
    attempts: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('control_events_seq_key').on(t.seq),
    index('control_events_created_idx').on(t.createdAt),
    index('control_events_undelivered_idx').on(t.seq).where(sql`delivered_at is null`),
  ],
);
