import { describe, expect, it } from 'vitest';
import { type KeyLockRedisClient, redisKeyLock } from '../src/index.js';

/** SET NX PX and the token-checked delete, in memory. */
function fakeRedis(): KeyLockRedisClient & { keys: Map<string, string> } {
  const keys = new Map<string, string>();
  return {
    keys,
    async set(key, value) {
      if (keys.has(key)) return null;
      keys.set(key, value);
      return 'OK';
    },
    async eval(_script, _numKeys, key, token) {
      if (keys.get(String(key)) !== token) return 0;
      keys.delete(String(key));
      return 1;
    },
    async quit() {},
  };
}

describe('redis key lock', () => {
  it('grants a key to one holder until it is released', async () => {
    const redis = fakeRedis();
    const lock = redisKeyLock(redis);

    const release = await lock.acquire('v', 1_000);
    expect(release).toBeTypeOf('function');
    expect(await lock.acquire('v', 1_000)).toBeNull();
    expect([...redis.keys.keys()]).toEqual(['manablox:lock:v']);

    await release?.();
    expect(await lock.acquire('v', 1_000)).toBeTypeOf('function');
  });

  it('does not release a key another holder took over', async () => {
    const redis = fakeRedis();
    const lock = redisKeyLock(redis);

    const release = await lock.acquire('v', 1_000);
    // Expired and taken by someone else.
    redis.keys.set('manablox:lock:v', 'other');
    await release?.();
    expect(redis.keys.get('manablox:lock:v')).toBe('other');
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('redis key lock over Redis', () => {
  it('shares a key between two connections and expires it', async () => {
    const a = redisKeyLock(redisUrl, { prefix: `manablox:test:lock:${process.pid}:` });
    const b = redisKeyLock(redisUrl, { prefix: `manablox:test:lock:${process.pid}:` });
    try {
      const release = await a.acquire('v', 5_000);
      expect(release).toBeTypeOf('function');
      expect(await b.acquire('v', 5_000)).toBeNull();
      await release?.();
      const again = await b.acquire('v', 100);
      expect(again).toBeTypeOf('function');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await a.acquire('v', 1_000)).toBeTypeOf('function');
    } finally {
      await a.close();
      await b.close();
    }
  });
});
