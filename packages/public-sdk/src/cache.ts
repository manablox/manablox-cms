export interface CacheOptions {
  /** Entry lifetime in ms. `0` disables caching but keeps deduplication. */
  ttl?: number;
  /** Entries kept before the oldest is evicted. */
  max?: number;
}

/** Per-client in-flight deduplication (always on) plus a small in-memory TTL cache. */
export class RequestCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly ttl: number;
  private readonly max: number;

  constructor(options: CacheOptions = {}) {
    this.ttl = options.ttl ?? 1000;
    this.max = options.max ?? 100;
  }

  async resolve<T>(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
    if (!fresh) {
      const hit = this.entries.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value as T;
      if (hit) this.entries.delete(key);

      const pending = this.inFlight.get(key);
      if (pending) return pending as Promise<T>;
    }

    const promise = load()
      .then((value) => {
        if (this.ttl > 0) this.store(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }

  private store(key: string, value: unknown): void {
    // Insertion-ordered: the first key is the oldest.
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttl });
  }
}

/** A cache key independent of object key order. */
export function cacheKey(operation: string, args: unknown): string {
  return `${operation}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
