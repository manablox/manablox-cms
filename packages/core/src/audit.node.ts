import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { type AuditActor, type AuditHashInput, auditHashPayload } from './audit.js';

/** The current actor, set once by the transport; absent means the system. */
const storage = new AsyncLocalStorage<AuditActor>();

export const SYSTEM_ACTOR: AuditActor = { kind: 'system', id: null, label: 'system' };

/** The external layer, writing through the control API. */
export const CONTROL_ACTOR: AuditActor = { kind: 'control', id: null, label: 'control API' };

export function systemActor(label: string, detail?: Record<string, unknown>): AuditActor {
  return { kind: 'system', id: null, label, ...(detail ? { detail } : {}) };
}

/** Runs `fn` with `actor` as the current actor for everything it awaits. */
export function runAsActor<T>(actor: AuditActor, fn: () => T): T {
  return storage.run(actor, fn);
}

/** The actor set by the nearest `runAsActor` up the stack, or the system. */
export function currentActor(): AuditActor {
  return storage.getStore() ?? SYSTEM_ACTOR;
}

/** The originating browser tab, stamped on realtime events so it can skip its own echo. */
const clientStorage = new AsyncLocalStorage<string>();

/** Runs `fn` with `clientId` as the originating client; a null id leaves it unset. */
export function runAsClient<T>(clientId: string | null | undefined, fn: () => T): T {
  return clientId ? clientStorage.run(clientId, fn) : fn();
}

/** The client id set by the nearest `runAsClient`, or `null` outside any request. */
export function currentClient(): string | null {
  return clientStorage.getStore() ?? null;
}

/** SHA-256 of the entry's canonical content chained to the previous hash. */
export function hashAuditEntry(input: AuditHashInput): string {
  return createHash('sha256').update(auditHashPayload(input)).digest('hex');
}
