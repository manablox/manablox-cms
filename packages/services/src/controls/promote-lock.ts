import { type createRedis, REDIS_PREFIX } from '@manablox/cache';
import type { Repositories } from '@manablox/db';

type Redis = ReturnType<typeof createRedis>;

/** Milliseconds a marker lives without a renewal; a crashed holder's expires then. */
export const PROMOTE_LOCK_TTL_MS = 60_000;

/** Milliseconds the read markers are used before they are read again, like the controls. */
export const PROMOTE_CHECK_MS = 5000;

/** A promote writing a space's production environment. */
export interface PromoteHold {
  productionId: string;
  /** Epoch milliseconds the marker expires at without a renewal. */
  until: number;
}

export interface PromoteLocksOptions {
  /** Shared markers in one hash; the database's `instance_meta` without. */
  redis?: Redis | null | undefined;
  ttl?: number | undefined;
  check?: number | undefined;
  /** Tells other processes a space's marker changed. */
  announce?: ((spaceId: string) => void) | undefined;
  /** A failed marker read or write; a failed read lets writes through. */
  onError?: ((error: unknown) => void) | undefined;
}

const PREFIX = 'promote:';
const HASH = `${REDIS_PREFIX}promotes`;

/**
 * Marks a space's production environment as being promoted into, for every process: a field
 * of a Redis hash, else an `instance_meta` row per space. Every marker is read in one call,
 * at most once per `PROMOTE_CHECK_MS`; the process holding one sees it at once.
 */
export class PromoteLocks {
  private readonly own = new Map<string, PromoteHold>();
  private snapshot: { holds: Map<string, PromoteHold>; expires: number } | null = null;
  private loading: Promise<Map<string, PromoteHold>> | null = null;
  private readonly ttl: number;
  private readonly check: number;

  constructor(
    private readonly repos: Repositories,
    private readonly options: PromoteLocksOptions = {},
  ) {
    this.ttl = options.ttl ?? PROMOTE_LOCK_TTL_MS;
    this.check = options.check ?? PROMOTE_CHECK_MS;
  }

  /** Runs `fn` with the marker set, renewed while it runs and removed after. */
  async hold<T>(spaceId: string, productionId: string, fn: () => Promise<T>): Promise<T> {
    await this.write(spaceId, productionId);
    this.options.announce?.(spaceId);
    const timer = setInterval(() => {
      void this.write(spaceId, productionId).catch((error: unknown) =>
        this.options.onError?.(error),
      );
    }, this.ttl / 3);
    timer.unref?.();
    try {
      return await fn();
    } finally {
      clearInterval(timer);
      this.own.delete(spaceId);
      await this.remove(spaceId).catch((error: unknown) => this.options.onError?.(error));
      this.snapshot = null;
      this.options.announce?.(spaceId);
    }
  }

  /** The space's running promote, if any. */
  async held(spaceId: string): Promise<PromoteHold | null> {
    const now = Date.now();
    const own = live(this.own.get(spaceId), now);
    if (own) return own;
    if (!this.snapshot || this.snapshot.expires <= now) {
      let holds = new Map<string, PromoteHold>();
      try {
        holds = await this.load();
      } catch (error) {
        this.options.onError?.(error);
      }
      this.snapshot = { holds, expires: now + this.check };
    }
    return live(this.snapshot.holds.get(spaceId), now);
  }

  /** Drops the read markers, so the next check reads them again. */
  forget(): void {
    this.snapshot = null;
  }

  private load(): Promise<Map<string, PromoteHold>> {
    this.loading ??= this.read().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async read(): Promise<Map<string, PromoteHold>> {
    const { redis } = this.options;
    if (!redis) {
      const rows = await this.repos.instanceMeta.listByPrefix<PromoteHold>(PREFIX);
      return new Map([...rows].map(([key, hold]) => [key.slice(PREFIX.length), hold]));
    }
    const fields = await redis.hgetall(HASH);
    return new Map(
      Object.entries(fields).map(([spaceId, raw]) => [spaceId, JSON.parse(raw) as PromoteHold]),
    );
  }

  private async write(spaceId: string, productionId: string): Promise<void> {
    const hold: PromoteHold = { productionId, until: Date.now() + this.ttl };
    this.own.set(spaceId, hold);
    const { redis } = this.options;
    if (redis) await redis.hset(HASH, spaceId, JSON.stringify(hold));
    else await this.repos.instanceMeta.set(`${PREFIX}${spaceId}`, hold);
  }

  private async remove(spaceId: string): Promise<void> {
    const { redis } = this.options;
    if (redis) await redis.hdel(HASH, spaceId);
    else await this.repos.instanceMeta.delete(`${PREFIX}${spaceId}`);
  }
}

/** A marker past its expiry is stale. */
function live(hold: PromoteHold | undefined, now: number): PromoteHold | null {
  return hold && hold.until > now ? hold : null;
}
