import type { AuditAction, AuditActorKind, AuditChange, AuditTargetKind } from '@manablox/core';
import { sql } from 'drizzle-orm';
import { id, index, json, serial, table, text, timestamp, uuid } from './define.js';

/**
 * Append-only action log with no foreign keys, so rows survive deletes. A trigger refuses
 * updates and deletes; each row's SHA-256 chains to the previous one.
 */
export const auditEntries = table(
  'audit_entries',
  {
    id: id(),
    /** Chain order. */
    seq: serial(),
    at: timestamp().notNull().defaultNow(),
    /** Null for instance-wide actions. */
    spaceId: uuid(),
    actorKind: text<AuditActorKind>().notNull(),
    actorId: text(),
    actorLabel: text().notNull(),
    actorDetail: json<Record<string, unknown>>(),
    action: text<AuditAction>().notNull(),
    targetKind: text<AuditTargetKind>().notNull(),
    targetId: text(),
    targetLabel: text(),
    changes: json<AuditChange[]>().notNull().default([]),
    meta: json<Record<string, unknown>>(),
    prevHash: text(),
    hash: text().notNull(),
  },
  (t) => [
    index('audit_entries_seq_idx').on(t.seq),
    index('audit_entries_space_at_idx').on(t.spaceId, t.at),
    index('audit_entries_target_idx').on(t.targetKind, t.targetId),
    index('audit_entries_actor_idx').on(t.actorKind, t.actorId),
    index('audit_entries_action_idx').on(t.action),
    // The log's free-text search (`%term%` over these three) reads them instead of every row.
    index('audit_entries_actor_label_trgm_idx').using('gin', sql`${t.actorLabel} gin_trgm_ops`),
    index('audit_entries_target_label_trgm_idx').using('gin', sql`${t.targetLabel} gin_trgm_ops`),
    index('audit_entries_action_trgm_idx').using('gin', sql`${t.action} gin_trgm_ops`),
  ],
);
