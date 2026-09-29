import type { AuditActorKind, AuditTargetKind } from './audit.js';

/** A live audit entry without its changes, broadcast to open admins. Browser-safe. */
export interface RealtimeEvent {
  /** The audit entry's id. */
  id: string;
  /** Strictly increasing, so a client can detect gaps. */
  seq: number;
  /** ISO timestamp. */
  at: string;
  spaceId: string | null;
  /** `<target>.<verb>`, the audit action. */
  action: string;
  targetKind: AuditTargetKind;
  targetId: string | null;
  targetLabel: string | null;
  actor: { kind: AuditActorKind; id: string | null; label: string };
  /** The originating tab (`x-manablox-client`), which skips its own events. */
  clientId: string | null;
}

/** The audit row a `RealtimeEvent` is built from. */
export interface RealtimeEventSource {
  id: string;
  seq: number;
  at: Date;
  spaceId: string | null;
  action: string;
  targetKind: string;
  targetId: string | null;
  actorKind: string;
  actorId: string | null;
  actorLabel: string;
  targetLabel: string | null;
}

export function realtimeEventFrom(
  row: RealtimeEventSource,
  clientId: string | null,
): RealtimeEvent {
  return {
    id: row.id,
    seq: row.seq,
    at: row.at.toISOString(),
    spaceId: row.spaceId,
    action: row.action,
    targetKind: row.targetKind as AuditTargetKind,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    actor: { kind: row.actorKind as AuditActorKind, id: row.actorId, label: row.actorLabel },
    clientId,
  };
}

/** Identifies a browser tab, so it is not told about its own writes. */
export const CLIENT_ID_HEADER = 'x-manablox-client';
