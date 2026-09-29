import { randomUUID } from 'node:crypto';
import { type createRedis, REDIS_PREFIX } from '@manablox/cache';
import {
  type AnyUsageMetric,
  CONTROL_CATALOGUE,
  type UsageMetric,
  usagePeriod,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories, UsageDelta } from '@manablox/db';

type Redis = ReturnType<typeof createRedis>;

/** Every metered metric, in catalogue order. */
export const USAGE_METRICS: readonly UsageMetric[] = Object.keys(CONTROL_CATALOGUE)
  .filter((key) => key.startsWith('usage.'))
  .map((key) => key.slice('usage.'.length) as UsageMetric);

/** Metrics the external layer may report, e.g. CDN hits. */
export const EXTERNAL_USAGE_METRICS = ['bandwidthBytes', 'apiRequests'] as const;

/** How often a process hands its counts to Redis. */
export const USAGE_BATCH_MS = 1000;

/** How often the anchor day is read again while counting. */
const ANCHOR_REFRESH_MS = 30_000;

/** A flushing hash this old was left by a flush that died; the next flush takes it. */
const ORPHAN_AFTER_MS = 5 * 60_000;

/** How long flushed batch ids are kept; far longer than a flushing hash can wait. */
const FLUSH_IDS_KEPT_MS = 7 * 24 * 60 * 60_000;

/** Renames the pending hash only when it exists. */
const TAKE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('RENAME', KEYS[1], KEYS[2])
return 1
`;

export interface UsageMeterOptions {
  /** Shared counts across processes; without it counts go to the database on `flush`. */
  redis?: Redis | null | undefined;
  /** `redis` is shared (e.g. `redisHub`'s): `close` leaves it open. */
  sharedRedis?: boolean | undefined;
  /** Key prefix in Redis; default `manablox:usage:`. */
  prefix?: string | undefined;
  /** The instance's `usagePeriodAnchorDay`. */
  anchorDay?: (() => Promise<number>) | undefined;
  now?: (() => number) | undefined;
}

/**
 * Counts usage per space, metric and period. `consume` only adds to a map; every second the
 * map goes to one Redis hash (`HINCRBY <prefix>pending <period>:<spaceId>:<metric>`), and
 * `flush` moves that hash into `usage_counters`. Without Redis `flush` writes the map itself.
 * Counts without a space go to the instance's own counter, the unattributed bucket.
 */
export class UsageMeter {
  private pending = new Map<string, number>();
  private anchor = 1;
  private anchorAt = 0;
  private period: { label: string; start: number; end: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pushing: Promise<void> | null = null;
  private closed = false;
  private readonly redis: Redis | null;
  private readonly pendingKey: string;
  private readonly flushingPrefix: string;
  private readonly now: () => number;

  constructor(
    private readonly manablox: Pick<Manablox, 'logger'>,
    private readonly repos: Repositories,
    private readonly options: UsageMeterOptions = {},
  ) {
    this.redis = options.redis ?? null;
    const prefix = options.prefix ?? `${REDIS_PREFIX}usage:`;
    this.pendingKey = `${prefix}pending`;
    this.flushingPrefix = `${prefix}flushing:`;
    this.now = options.now ?? Date.now;
  }

  /** Whether counts go through Redis. */
  get shared(): boolean {
    return this.redis !== null;
  }

  /** Adds to the process's counts; never throws, never waits. `null` counts unattributed. */
  consume(spaceId: string | null, metric: AnyUsageMetric, amount: number): void {
    if (this.closed || !(amount > 0) || !Number.isFinite(amount)) return;
    const key = `${this.periodLabel()}:${spaceId ?? ''}:${metric}`;
    this.pending.set(key, (this.pending.get(key) ?? 0) + Math.round(amount));
  }

  /** The label of the current period, with the anchor last read. */
  currentPeriod(): string {
    return this.periodLabel();
  }

  /** Reads the anchor day again; the next count uses it. */
  async refreshAnchor(): Promise<void> {
    if (!this.options.anchorDay) return;
    this.anchorAt = this.now();
    const day = await this.options.anchorDay();
    if (day !== this.anchor) {
      this.anchor = day;
      this.period = null;
    }
  }

  /** Hands counts to Redis every second; a no-op without Redis. */
  start(): void {
    if (this.timer || this.closed) return;
    this.refreshAnchorQuietly();
    this.timer = setInterval(() => this.tick(), USAGE_BATCH_MS);
    this.timer.unref?.();
  }

  /**
   * Moves counts into `usage_counters`: with Redis the shared hash, renamed first so counts
   * arriving meanwhile start a new one, and counted once by its name; without Redis this
   * process's counts, which no other process can count again.
   */
  async flush(): Promise<void> {
    if (!this.redis) return this.writePending();
    await this.push();
    const taken = `${this.flushingPrefix}${this.now()}:${randomUUID()}`;
    const renamed = await this.redis.eval(TAKE_SCRIPT, 2, this.pendingKey, taken);
    const keys = [...(renamed === 1 ? [taken] : []), ...(await this.orphans(taken))];
    const at = new Date(this.now());
    for (const key of keys) {
      const hash = await this.redis.hgetall(key);
      const deltas = deltasOf(Object.entries(hash).map(([field, value]) => [field, Number(value)]));
      // The key names the batch; a batch counted before is skipped and only dropped.
      const id = key.slice(this.flushingPrefix.length);
      if (deltas.length > 0) {
        await this.repos.transaction((tx) => tx.usageCounters.incrementOnce(id, deltas, at));
      }
      await this.redis.del(key);
    }
    await this.repos.usageCounters.pruneFlushes(new Date(at.getTime() - FLUSH_IDS_KEPT_MS));
  }

  /** Stops counting and hands the last counts on: to Redis, else to the database. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      if (this.redis) await this.push();
      else await this.writePending();
    } catch (error) {
      this.manablox.logger.warn({ err: error }, 'usage counts lost on shutdown');
    }
    if (!this.options.sharedRedis) await this.redis?.quit().catch(() => {});
  }

  private tick(): void {
    if (this.pending.size > 0 && this.now() - this.anchorAt >= ANCHOR_REFRESH_MS) {
      this.refreshAnchorQuietly();
    }
    if (!this.redis) return;
    this.push().catch((error: unknown) =>
      this.manablox.logger.debug({ err: error }, 'usage counts kept for the next try'),
    );
  }

  private refreshAnchorQuietly(): void {
    this.refreshAnchor().catch((error: unknown) =>
      this.manablox.logger.debug({ err: error }, 'usage anchor day not read'),
    );
  }

  /** One push at a time; a failed one puts its counts back. */
  private push(): Promise<void> {
    this.pushing ??= this.pushOnce().finally(() => {
      this.pushing = null;
    });
    return this.pushing;
  }

  private async pushOnce(): Promise<void> {
    const redis = this.redis;
    if (!redis || this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      const multi = redis.multi();
      for (const [field, amount] of batch) multi.hincrby(this.pendingKey, field, amount);
      const results = await multi.exec();
      const failed = results?.find(([error]) => error)?.[0];
      if (!results || failed) throw failed ?? new Error('usage batch discarded');
    } catch (error) {
      this.restore(batch);
      throw error;
    }
  }

  private async writePending(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      await this.repos.usageCounters.incrementMany(deltasOf(batch));
    } catch (error) {
      this.restore(batch);
      throw error;
    }
  }

  private restore(batch: Map<string, number>): void {
    for (const [key, amount] of batch) this.pending.set(key, (this.pending.get(key) ?? 0) + amount);
  }

  /** Flushing hashes older than `ORPHAN_AFTER_MS`, left by a flush that died. */
  private async orphans(except: string): Promise<string[]> {
    const redis = this.redis;
    if (!redis) return [];
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${this.flushingPrefix}*`,
        'COUNT',
        100,
      );
      cursor = next;
      for (const key of keys) {
        const at = Number(key.slice(this.flushingPrefix.length).split(':')[0]);
        if (key !== except && this.now() - at >= ORPHAN_AFTER_MS) out.push(key);
      }
    } while (cursor !== '0');
    return out;
  }

  private periodLabel(): string {
    const now = this.now();
    const current = this.period;
    if (current && now >= current.start && now < current.end) return current.label;
    const period = usagePeriod(new Date(now), this.anchor);
    this.period = { label: period.label, start: period.start.getTime(), end: period.end.getTime() };
    return period.label;
  }
}

/** Deltas from `<period>:<spaceId>:<metric>` fields; an empty space id is the instance's. */
function deltasOf(entries: Iterable<[string, number]>): UsageDelta[] {
  const out: UsageDelta[] = [];
  for (const [field, delta] of entries) {
    const [period, spaceId, metric] = field.split(':');
    if (!period || spaceId === undefined || !metric || !Number.isFinite(delta) || delta === 0) {
      continue;
    }
    const scope = spaceId ? { kind: 'space' as const, id: spaceId } : { kind: 'instance' as const };
    out.push({ scope, metric, period, delta });
  }
  return out;
}

/**
 * Counts what hooks report: API requests and bytes from `request:served`, mails sent
 * through the instance's transport from `mail:afterSend`. Requests without a space count
 * unattributed; editors' own mailboxes are not counted.
 */
export function attachUsageMetering(manablox: Manablox): () => void {
  const offServed = manablox.hooks.on(
    'request:served',
    ({ surface, spaceId, bytes }) => {
      const owner = spaceId || null;
      if (surface === 'delivery' || surface === 'management') {
        manablox.controls.consume(owner, 'apiRequests', 1);
      }
      if (surface !== 'management') manablox.controls.consume(owner, 'bandwidthBytes', bytes);
    },
    { source: 'controls' },
  );
  const offMail = manablox.hooks.on(
    'mail:afterSend',
    ({ spaceId, recipients, transport }) => {
      if (spaceId && transport === 'instance') {
        manablox.controls.consume(spaceId, 'mails', recipients);
      }
    },
    { source: 'controls' },
  );
  return () => {
    offServed();
    offMail();
  };
}
