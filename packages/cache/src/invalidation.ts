import { randomUUID } from 'node:crypto';
import type { Manablox } from '@manablox/core/node';
import { redisHub } from './hub.js';
import { REDIS_PREFIX } from './redis.js';

/** The channel processes announce stale keys of one kind on. */
export const invalidationChannel = (kind: string): string => `${REDIS_PREFIX}invalidate:${kind}`;

export interface InvalidationBus {
  /** Tells every other process that `key` went stale; never throws. */
  publish(key: string): void;
}

/**
 * Keeps a per-process cache in step across the processes sharing Redis. `drop` gets each key
 * another process announced, or no key after a reconnect, when announcements may have been
 * missed. Null without Redis. Every kind shares the process's two connections (`redisHub`).
 */
export function attachInvalidation(
  manablox: Manablox,
  kind: string,
  drop: (key?: string) => void,
): InvalidationBus | null {
  const hub = redisHub(manablox);
  if (!hub) return null;

  const channel = invalidationChannel(kind);
  const instance = randomUUID();
  const unsubscribe = hub.subscribe(channel, (message) => {
    const space = message.indexOf(' ');
    if (space < 0 || message.slice(0, space) === instance) return;
    drop(message.slice(space + 1));
  });
  const unwatch = hub.onReconnect(() => drop());
  manablox.onDispose(() => {
    unsubscribe();
    unwatch();
  });

  return {
    publish(key) {
      hub.publish(channel, `${instance} ${key}`);
    },
  };
}
