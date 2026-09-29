import { randomUUID } from 'node:crypto';
import { createRedis, REDIS_PREFIX } from './redis.js';

/** A short lock per key, shared by every replica through Redis. */
export interface KeyLock {
  /** Resolves to the release, or null while another holder has the key. */
  acquire(key: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
  close(): Promise<void>;
}

/** The subset of a Redis client the lock needs, so tests can substitute one. */
export interface KeyLockRedisClient {
  set(key: string, value: string, px: 'PX', ttl: number, nx: 'NX'): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

/** Deletes the key only while it still holds this holder's token. */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export function redisKeyLock(
  target: string | KeyLockRedisClient,
  options: { prefix?: string } = {},
): KeyLock {
  const redis: KeyLockRedisClient =
    typeof target === 'string'
      ? (createRedis(target, 'lock') as unknown as KeyLockRedisClient)
      : target;
  const prefix = options.prefix ?? `${REDIS_PREFIX}lock:`;

  return {
    async acquire(key, ttlMs) {
      const token = randomUUID();
      const name = `${prefix}${key}`;
      const taken = await redis.set(name, token, 'PX', ttlMs, 'NX');
      if (taken !== 'OK') return null;
      return async () => {
        await redis.eval(RELEASE_SCRIPT, 1, name, token);
      };
    },
    async close() {
      // A connection passed in belongs to the caller.
      if (typeof target === 'string') await redis.quit();
    },
  };
}
