import type { ManabloxConfig } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCache, attachInvalidation, createCache, localCache } from '../src/index.js';

const instances: Manablox[] = [];

function instance(cache: ManabloxConfig['cache']): Manablox {
  const manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: [],
    contentTypes: [],
    cache,
    logging: { adapters: [{ name: 'discard', stream: { write() {} } }] },
  } as unknown as ManabloxConfig);
  instances.push(manablox);
  return manablox;
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((manablox) => manablox.stop()));
});

describe('invalidation without Redis', () => {
  it('is off', () => {
    expect(attachInvalidation(instance({}), 'things', () => {})).toBeNull();
  });
});

describe('local caches and the cache flag', () => {
  it('keep loads with the cache on and nothing with it off', async () => {
    for (const [enabled, loads] of [
      [true, 1],
      [false, 3],
    ] as const) {
      const cache = localCache<string>(instance({ enabled }), { max: 10, ttlMs: 60_000 });
      const load = vi.fn(async () => ({ value: 'v', tags: ['space:1'] }));
      for (let index = 0; index < 3; index++) expect(await cache.load('k', load)).toBe('v');
      expect(load).toHaveBeenCalledTimes(loads);
    }
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('invalidation over Redis', () => {
  it('drops the key in every other process, not in the sender', async () => {
    const sender = vi.fn();
    const receiver = vi.fn();
    const other = vi.fn();
    const bus = attachInvalidation(instance({ redisUrl }), 'things', sender);
    attachInvalidation(instance({ redisUrl }), 'things', receiver);
    attachInvalidation(instance({ redisUrl }), 'other-things', other);
    // Subscribing is asynchronous; an announcement before it would be missed.
    await new Promise((resolve) => setTimeout(resolve, 200));

    bus?.publish('space-1');
    bus?.publish('space 2');

    await vi.waitFor(() => expect(receiver).toHaveBeenCalledTimes(2));
    expect(receiver).toHaveBeenNthCalledWith(1, 'space-1');
    expect(receiver).toHaveBeenNthCalledWith(2, 'space 2');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sender).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});

describe.skipIf(!redisUrl)('local caches across processes', () => {
  it('drops a purged tag in the other replica, and only entries carrying it', async () => {
    const one = instance({ redisUrl });
    const two = instance({ redisUrl });
    attachCache(one, createCache({ redisUrl, ttl: 60, enabled: true }));
    attachCache(two, createCache({ redisUrl, ttl: 60, enabled: true }));
    const here = localCache<string>(one, { max: 10, ttlMs: 60_000 });
    const there = localCache<string>(two, { max: 10, ttlMs: 60_000 });
    for (const cache of [here, there]) {
      cache.set('host:a', 'a', ['domains', 'space:1']);
      cache.set('host:b', 'b', ['space:2']);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));

    await one.hooks.run('cache:purge', { tags: ['space:1'] }, { manablox: one, spaceId: '1' });

    // The purging process drops at once, the other one when the announcement arrives.
    expect(here.get('host:a')).toBeUndefined();
    await vi.waitFor(() => expect(there.get('host:a')).toBeUndefined());
    expect(here.get('host:b')).toBe('b');
    expect(there.get('host:b')).toBe('b');
  });
});
