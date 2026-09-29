import type { Manablox } from '@manablox/core/node';

export interface LocalCacheOptions {
  /** Entries kept; the least recently used go first. */
  max: number;
  /** Milliseconds an entry lives, however quiet the purges. */
  ttlMs: number;
  /** Keeps nothing: every `load` runs, e.g. with `CACHE_ENABLED=false`. */
  disabled?: boolean | undefined;
}

interface Entry<T> {
  value: T;
  tags: readonly string[];
  expiresAt: number;
}

/**
 * Per-request lookups kept in process for seconds: an LRU with a time limit whose entries
 * carry cache tags. A `cache:purge` of any of their tags drops them, in this process and,
 * over Redis, in every other one (`attachCache` relays purges), so a replica never serves a
 * lookup older than the last purge by more than the relay's delay.
 */
export class LocalCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly byTag = new Map<string, Set<string>>();
  private readonly loading = new Map<string, Promise<T>>();
  /** Bumped by every purge; a load that saw one start is not kept. */
  private epoch = 0;

  constructor(private readonly options: LocalCacheOptions) {}

  get(key: string): T | undefined {
    if (this.options.disabled) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.remove(key);
      return undefined;
    }
    // Most recently used last.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /**
   * The kept value, else `load()`'s, kept under its tags. Concurrent misses share one load;
   * a purge while it runs means the result may predate it, so it is returned but not kept.
   */
  async load(key: string, load: () => Promise<{ value: T; tags: readonly string[] }>): Promise<T> {
    if (this.options.disabled) return (await load()).value;
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.loading.get(key);
    if (pending) return pending;
    const epoch = this.epoch;
    const run = load()
      .then(({ value, tags }) => {
        if (epoch === this.epoch) this.set(key, value, tags);
        return value;
      })
      .finally(() => this.loading.delete(key));
    this.loading.set(key, run);
    return run;
  }

  set(key: string, value: T, tags: readonly string[]): void {
    if (this.options.disabled) return;
    this.remove(key);
    this.entries.set(key, { value, tags, expiresAt: Date.now() + this.options.ttlMs });
    for (const tag of tags) {
      let keys = this.byTag.get(tag);
      if (!keys) {
        keys = new Set();
        this.byTag.set(tag, keys);
      }
      keys.add(key);
    }
    while (this.entries.size > this.options.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  /** Drops every entry carrying one of `tags`. */
  purge(tags: readonly string[]): void {
    this.epoch++;
    this.loading.clear();
    for (const tag of tags) {
      for (const key of this.byTag.get(tag) ?? []) this.remove(key);
    }
  }

  /** Drops everything, e.g. after purges may have been missed. */
  clear(): void {
    this.epoch++;
    this.loading.clear();
    this.entries.clear();
    this.byTag.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    for (const tag of entry.tags) {
      const keys = this.byTag.get(tag);
      keys?.delete(key);
      if (keys?.size === 0) this.byTag.delete(tag);
    }
  }
}

const registries = new WeakMap<Manablox, Set<LocalCache<unknown>>>();

function registry(manablox: Manablox): Set<LocalCache<unknown>> {
  let caches = registries.get(manablox);
  if (!caches) {
    caches = new Set();
    registries.set(manablox, caches);
  }
  return caches;
}

/**
 * A `LocalCache` that the instance's cache purges reach; see `attachCache`. With the cache
 * off (`cache.enabled: false`) it keeps nothing.
 */
export function localCache<T>(manablox: Manablox, options: LocalCacheOptions): LocalCache<T> {
  const cache = new LocalCache<T>({
    ...options,
    disabled: options.disabled || !manablox.config.cache.enabled,
  });
  registry(manablox).add(cache as LocalCache<unknown>);
  return cache;
}

/** Drops `tags` from every local cache of the instance; all of them without tags. */
export function purgeLocal(manablox: Manablox, tags?: readonly string[]): void {
  for (const cache of registries.get(manablox) ?? []) {
    if (tags) cache.purge(tags);
    else cache.clear();
  }
}
