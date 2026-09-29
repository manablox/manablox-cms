import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCache, MemoryCache, REDIS_PREFIX } from '../src/index.js';

/** No `redisUrl` selects the in-process cache. */
const memory = () => createCache({ enabled: true, ttl: 60 });

describe('tagged cache', () => {
  it('stores and reads a value', async () => {
    const cache = memory();
    await cache.set('a', { hello: 'world' }, {});
    expect(await cache.get('a')).toEqual({ hello: 'world' });
    expect(await cache.get('missing')).toBeNull();
  });

  it('expires an entry once its TTL has passed', async () => {
    const cache = createCache({ enabled: true, ttl: 60 });
    await cache.set('short', 1, { ttl: -1 });
    expect(await cache.get('short')).toBeNull();
  });

  it('purges only the entries carrying a tag', async () => {
    const cache = memory();
    await cache.set('page-1', 'a', { tags: ['content:1', 'space:s'] });
    await cache.set('page-2', 'b', { tags: ['content:2', 'space:s'] });
    await cache.set('unrelated', 'c', { tags: [] });

    expect(await cache.purge(['content:1'])).toBe(1);
    expect(await cache.get('page-1')).toBeNull();
    expect(await cache.get('page-2')).toBe('b');
    expect(await cache.get('unrelated')).toBe('c');
  });

  it('purges every entry sharing a broader tag', async () => {
    const cache = memory();
    await cache.set('a', 1, { tags: ['space:s'] });
    await cache.set('b', 2, { tags: ['space:s'] });
    expect(await cache.purge(['space:s'])).toBe(2);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });

  it('treats an unknown tag and an empty list as no-ops', async () => {
    const cache = memory();
    await cache.set('a', 1, { tags: ['x'] });
    expect(await cache.purge([])).toBe(0);
    expect(await cache.purge(['nothing'])).toBe(0);
    expect(await cache.get('a')).toBe(1);
  });

  it('hands out copies, so a caller mutating a value cannot change the entry', async () => {
    const cache = memory();
    const value = { list: [1], at: new Date(0) };
    await cache.set('a', value, {});
    value.list.push(2);
    const read = await cache.get<typeof value>('a');
    expect(read).toEqual({ list: [1], at: new Date(0) });
    read?.list.push(3);
    expect(await cache.get('a')).toEqual({ list: [1], at: new Date(0) });
  });

  it('sweeps expired entries and their tag memberships', async () => {
    const cache = new MemoryCache(60, 0);
    await cache.set('old', 1, { ttl: -1, tags: ['space:s'] });
    await cache.set('kept', 2, { tags: ['space:t'] });
    expect(cache.size).toEqual({ entries: 1, tags: 1 });
    expect(await cache.get('kept')).toBe(2);
  });

  it('is inert when caching is disabled', async () => {
    const cache = createCache({ enabled: false, ttl: 60 });
    await cache.set('a', 1, { tags: ['t'] });
    expect(await cache.get('a')).toBeNull();
    expect(await cache.purge(['t'])).toBe(0);
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('tagged cache over Redis', () => {
  it('clears its own keys and leaves the rest of the db alone', async () => {
    const { Redis } = await import('ioredis');
    const redis = new Redis(redisUrl);
    const foreign = `bull:cache-test:${Date.now()}`;
    const cache = createCache({ enabled: true, ttl: 60, redisUrl });
    try {
      await redis.set(foreign, 'queued');
      await cache.set('entry', 1, { tags: ['space:s'] });
      expect(await redis.exists(`${REDIS_PREFIX}c:entry`)).toBe(1);
      expect(await redis.zscore(`${REDIS_PREFIX}tz:space:s`, 'entry')).not.toBeNull();

      await cache.clear();

      expect(await cache.get('entry')).toBeNull();
      expect(await redis.exists(`${REDIS_PREFIX}tz:space:s`)).toBe(0);
      expect(await redis.get(foreign)).toBe('queued');
    } finally {
      await redis.del(foreign);
      await redis.quit();
      await cache.close();
    }
  });
});

describe.skipIf(!redisUrl)('createRedis', () => {
  it('names the connection after its role', async () => {
    const { createRedis } = await import('../src/index.js');
    const redis = createRedis(redisUrl, 'rateLimit');
    try {
      expect(await redis.client('GETNAME')).toBe(`${REDIS_PREFIX}rateLimit`);
    } finally {
      await redis.quit();
    }
  });
});

describe.skipIf(!redisUrl)('tag sets over Redis', () => {
  const tag = `${REDIS_PREFIX}tz:hot`;
  let redis: import('ioredis').Redis;
  let cache: ReturnType<typeof createCache>;
  beforeEach(async () => {
    const { Redis } = await import('ioredis');
    redis = new Redis(redisUrl);
    cache = createCache({ enabled: true, ttl: 60, redisUrl });
    await cache.clear();
  });
  afterEach(async () => {
    await cache.clear();
    await redis.quit();
    await cache.close();
  });

  it('purges exactly the entries of a tag, whatever their other tags', async () => {
    await cache.set('a', 1, { tags: ['hot', 'x'] });
    await cache.set('b', 2, { tags: ['hot'] });
    await cache.set('c', 3, { tags: ['x'] });
    await cache.set('d', 4, { tags: ['y'] });
    expect(await cache.purge(['hot'])).toBe(2);
    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('c')).toBe(3);
    expect(await cache.purge(['x', 'y'])).toBe(2);
    expect(await cache.get('d')).toBeNull();
  });

  it('keeps only live members, so a hot tag stays as big as its live entries', async () => {
    for (let index = 0; index < 50; index++)
      await cache.set(`old-${index}`, index, { ttl: 1, tags: ['hot'] });
    expect(await redis.zcard(tag)).toBe(50);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await cache.set('new', 1, { ttl: 60, tags: ['hot'] });
    expect(await redis.zcard(tag)).toBe(1);
    expect(await cache.purge(['hot'])).toBe(1);
  });

  it('keeps a tag as long as its longest-lived entry', async () => {
    await cache.set('long', 1, { ttl: 600, tags: ['hot'] });
    await cache.set('short', 2, { ttl: 1, tags: ['hot'] });
    expect(await redis.pttl(tag)).toBeGreaterThan(600_000);
  });
});
