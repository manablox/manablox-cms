import type { ManabloxHooks } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';

/** Write hooks that built-in listeners follow inside the write's transaction. */
export type WriteEvent =
  | 'content:afterCreate'
  | 'content:afterUpdate'
  | 'content:afterPublish'
  | 'content:afterUnpublishMany'
  | 'content:afterDeleteMany';

/** Gets the hook's payload and context, and the repositories of the write's transaction. */
export type WriteListener<K extends WriteEvent> = (
  payload: ManabloxHooks[K][0],
  context: ManabloxHooks[K][1],
  repos: Repositories,
) => unknown;

type AnyListener = (payload: unknown, context: unknown, repos: Repositories) => unknown;

const registries = new WeakMap<Manablox, Map<WriteEvent, AnyListener[]>>();

/**
 * Registers a built-in listener that runs inside the write's transaction, before commit and
 * before the plugin hook of the same name. A throw rolls the write back. Returns an unsubscribe.
 */
export function onWrite<K extends WriteEvent>(
  manablox: Manablox,
  event: K,
  listener: WriteListener<K>,
): () => void {
  const registry = registries.get(manablox) ?? new Map<WriteEvent, AnyListener[]>();
  registries.set(manablox, registry);
  const listeners = registry.get(event) ?? [];
  registry.set(event, [...listeners, listener as AnyListener]);
  return () => {
    registry.set(
      event,
      (registry.get(event) ?? []).filter((entry) => entry !== listener),
    );
  };
}

/** Runs `event`'s built-in listeners in registration order on `repos`. */
export async function runWriteListeners<K extends WriteEvent>(
  manablox: Manablox,
  event: K,
  payload: ManabloxHooks[K][0],
  context: ManabloxHooks[K][1],
  repos: Repositories,
): Promise<void> {
  for (const listener of registries.get(manablox)?.get(event) ?? []) {
    await listener(payload, context, repos);
  }
}
