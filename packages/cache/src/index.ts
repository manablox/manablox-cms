import type { CacheConfig } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Redis } from 'ioredis';
import { attachInvalidation } from './invalidation.js';
import { purgeLocal } from './local.js';
import { createRedis, REDIS_PREFIX } from './redis.js';

export * from './hub.js';
export * from './invalidation.js';
export * from './key-lock.js';
export * from './local.js';
export * from './rate-limit-store.js';
export * from './redis.js';
export * from './registry-sync.js';
export * from './touched.js';

export interface TaggedCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options: { ttl?: number; tags?: string[] }): Promise<void>;
  purge(tags: string[]): Promise<number>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

const ENTRY = `${REDIS_PREFIX}c:`;
/** Sorted sets: a tag's entry keys scored by when they expire. */
const TAG = `${REDIS_PREFIX}tz:`;

/**
 * Stores an entry and files it under its tags, atomically with respect to a purge. Each tag
 * drops the members that expired before adding this one, so a hot tag holds its live entries
 * only, and lives as long as its longest-lived entry (plus a minute). Time is Redis's own, so
 * replicas with skewed clocks agree on what is live.
 * KEYS: entry, tags...; ARGV: value, ttl seconds, member.
 */
const SET_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local ttl = tonumber(ARGV[2])
redis.call('SET', KEYS[1], ARGV[1], 'EX', ttl)
local expires = now + ttl * 1000
local keep = ttl * 1000 + 60000
for i = 2, #KEYS do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  redis.call('ZADD', KEYS[i], expires, ARGV[3])
  if redis.call('PTTL', KEYS[i]) < keep then redis.call('PEXPIRE', KEYS[i], keep) end
end
`;

/**
 * Deletes the live entries of the tags and the tags: reads only members that have not
 * expired, so a purge costs what the tag holds now. KEYS: tags; ARGV: entry key prefix.
 */
const PURGE_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local purged = 0
for i = 1, #KEYS do
  local members = redis.call('ZRANGEBYSCORE', KEYS[i], now, '+inf')
  for j = 1, #members, 500 do
    local batch = {}
    for k = j, math.min(j + 499, #members) do batch[#batch + 1] = ARGV[1] .. members[k] end
    purged = purged + redis.call('DEL', unpack(batch))
  end
  redis.call('DEL', KEYS[i])
end
return purged
`;

type ScriptedRedis = Redis & {
  cacheSet(numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  cachePurge(numberOfKeys: number, ...args: string[]): Promise<number>;
};

/** Tag-indexed cache, so a publish purges exactly the entries that referenced it. */
class RedisCache implements TaggedCache {
  private readonly redis: ScriptedRedis;
  /** A connection the cache made itself is closed with it; a shared one is not. */
  private readonly owned: boolean;

  constructor(
    target: string | Redis,
    private readonly defaultTtl: number,
  ) {
    this.owned = typeof target === 'string';
    const redis = typeof target === 'string' ? createRedis(target, 'cache') : target;
    redis.defineCommand('cacheSet', { lua: SET_SCRIPT });
    redis.defineCommand('cachePurge', { lua: PURGE_SCRIPT });
    this.redis = redis as ScriptedRedis;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(`${ENTRY}${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(
    key: string,
    value: T,
    options: { ttl?: number; tags?: string[] } = {},
  ): Promise<void> {
    const ttl = options.ttl ?? this.defaultTtl;
    const tags = [...new Set(options.tags ?? [])].map((tag) => `${TAG}${tag}`);
    await this.redis.cacheSet(
      1 + tags.length,
      `${ENTRY}${key}`,
      ...tags,
      JSON.stringify(value),
      ttl,
      key,
    );
  }

  async purge(tags: string[]): Promise<number> {
    if (tags.length === 0) return 0;
    const keys = [...new Set(tags)].map((tag) => `${TAG}${tag}`);
    return this.redis.cachePurge(keys.length, ...keys, ENTRY);
  }

  /** Deletes only the cache's own keys; queues and other users of the db stay. */
  async clear(): Promise<void> {
    for (const match of [`${ENTRY}*`, `${TAG}*`]) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await this.redis.unlink(...keys);
      } while (cursor !== '0');
    }
  }

  async close(): Promise<void> {
    if (this.owned) await this.redis.quit();
  }
}

/** In-process fallback for single-node deployments. Values are copied in and out, as over Redis. */
export class MemoryCache implements TaggedCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly tags = new Map<string, Set<string>>();
  private nextSweep: number;

  constructor(
    private readonly defaultTtl: number,
    /** Milliseconds between sweeps of expired entries, run from `set`. */
    private readonly sweepInterval = 60_000,
  ) {
    this.nextSweep = Date.now() + sweepInterval;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return structuredClone(entry.value) as T;
  }

  async set<T>(
    key: string,
    value: T,
    options: { ttl?: number; tags?: string[] } = {},
  ): Promise<void> {
    const now = Date.now();
    if (now >= this.nextSweep) this.sweep(now);

    this.entries.set(key, {
      value: structuredClone(value),
      expiresAt: now + (options.ttl ?? this.defaultTtl) * 1000,
    });
    for (const tag of options.tags ?? []) {
      const set = this.tags.get(tag) ?? new Set();
      set.add(key);
      this.tags.set(tag, set);
    }
  }

  async purge(tags: string[]): Promise<number> {
    let purged = 0;
    for (const tag of tags) {
      for (const key of this.tags.get(tag) ?? []) {
        if (this.entries.delete(key)) purged++;
      }
      this.tags.delete(tag);
    }
    return purged;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.tags.clear();
  }

  async close(): Promise<void> {
    await this.clear();
  }

  /** Drops expired entries and tag memberships of keys no longer held. */
  sweep(now = Date.now()): void {
    this.nextSweep = now + this.sweepInterval;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(key);
    }
    for (const [tag, keys] of this.tags) {
      for (const key of keys) if (!this.entries.has(key)) keys.delete(key);
      if (keys.size === 0) this.tags.delete(tag);
    }
  }

  /** Entry and tag counts, for tests. */
  get size(): { entries: number; tags: number } {
    return { entries: this.entries.size, tags: this.tags.size };
  }
}

class NullCache implements TaggedCache {
  async get<T>(): Promise<T | null> {
    return null;
  }
  async set(): Promise<void> {}
  async purge(): Promise<number> {
    return 0;
  }
  async clear(): Promise<void> {}
  async close(): Promise<void> {}
}

/**
 * The tagged cache `config` asks for: none when off, Redis with a URL (on `options.redis`, a
 * shared connection such as `redisHub`'s, when given), else in memory.
 */
export function createCache(
  config: CacheConfig & { ttl: number; enabled: boolean },
  options: { redis?: Redis | null | undefined } = {},
): TaggedCache {
  if (!config.enabled) return new NullCache();
  if (!config.redisUrl) return new MemoryCache(config.ttl);
  return new RedisCache(options.redis ?? config.redisUrl, config.ttl);
}

/**
 * Wires the cache to the `cache:purge` hook. A purge also drops the tags from the process's
 * local caches (`localCache`) and, with Redis, from every other process's.
 */
export function attachCache(manablox: Manablox, cache: TaggedCache): void {
  // Tags hold no spaces, so a message is the tag list joined by one; no message after a
  // reconnect, when purges may have been missed.
  const bus = attachInvalidation(manablox, 'tags', (message) =>
    purgeLocal(manablox, message === undefined ? undefined : message.split(' ')),
  );
  manablox.hooks.on(
    'cache:purge',
    async (payload) => {
      const purged = await cache.purge(payload.tags);
      if (payload.tags.length > 0) {
        purgeLocal(manablox, payload.tags);
        bus?.publish(payload.tags.join(' '));
      }
      manablox.logger.debug({ tags: payload.tags, purged }, 'cache purged');
    },
    { source: '@manablox/cache' },
  );

  manablox.onDispose(() => cache.close());
}
