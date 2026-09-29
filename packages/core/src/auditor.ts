import type { AuditAction, AuditActor, AuditChange, AuditTargetKind } from './audit.js';

/** One entry as the audit repository takes it. */
export interface AuditRecordInput {
  spaceId?: string | null | undefined;
  actor?: AuditActor | undefined;
  action: AuditAction;
  targetKind: AuditTargetKind;
  targetId?: string | null | undefined;
  targetLabel?: string | null | undefined;
  changes?: AuditChange[] | undefined;
  meta?: Record<string, unknown> | null | undefined;
}

/** Where an auditor writes; repositories and transaction repositories both fit. */
export interface AuditSink {
  audit: { record(input: AuditRecordInput): Promise<unknown> };
}

export interface AuditorOptions<Row> {
  /** The entry's space; `row.spaceId` when omitted. */
  spaceId?: (row: Row) => string | null | undefined;
  /** Row facts under each entry's meta; the call's meta wins on a clash. */
  meta?: (row: Row) => Record<string, unknown>;
  /** A fixed actor; the current actor when omitted. */
  actor?: AuditActor;
}

export interface Auditor<Row> {
  /** The entry `record` writes, for batching with `recordMany`. */
  entry(
    action: AuditAction,
    row: Row,
    changes?: AuditChange[],
    meta?: Record<string, unknown> | null,
  ): AuditRecordInput;
  record(
    action: AuditAction,
    row: Row,
    changes?: AuditChange[],
    meta?: Record<string, unknown> | null,
  ): Promise<unknown>;
  /** The same auditor writing through other repositories, e.g. a transaction's. */
  in(sink: AuditSink): Auditor<Row>;
}

type AuditRow = { id: string | null; spaceId?: string | null | undefined };

/** Builds one target kind's audit entries the same way at every write. */
export function auditor<Row extends AuditRow>(
  sink: AuditSink,
  targetKind: AuditTargetKind,
  label: (row: Row) => string | null | undefined,
  options: AuditorOptions<Row> = {},
): Auditor<Row> {
  const entry: Auditor<Row>['entry'] = (action, row, changes, meta) => {
    const input: AuditRecordInput = {
      spaceId: options.spaceId ? options.spaceId(row) : row.spaceId,
      action,
      targetKind,
      targetId: row.id,
      targetLabel: label(row),
    };
    if (options.actor) input.actor = options.actor;
    if (changes) input.changes = changes;
    // Environment-scoped rows name their environment.
    const environmentId = (row as { environmentId?: unknown }).environmentId;
    const facts = {
      ...(typeof environmentId === 'string' ? { environmentId } : {}),
      ...options.meta?.(row),
    };
    if (Object.keys(facts).length) input.meta = { ...facts, ...meta };
    else if (meta) input.meta = meta;
    return input;
  };
  return {
    entry,
    record: (action, row, changes, meta) => sink.audit.record(entry(action, row, changes, meta)),
    in: (other) => auditor(other, targetKind, label, options),
  };
}
