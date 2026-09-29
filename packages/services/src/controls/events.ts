import { type createRedis, REDIS_PREFIX } from '@manablox/cache';
import {
  type ControlEmitOptions,
  type ControlEventType,
  type ControlScope,
  scopeLabel,
  type UsageLevel,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import { type Repositories, whenCommitted } from '@manablox/db';
import type { UsageTransitionHandler } from './usage-state.js';

type Redis = ReturnType<typeof createRedis>;

/** Seconds a sampled event keeps others of its type, scope and key out. */
export const CONTROL_EVENT_SAMPLE_SECONDS = 60 * 60;

/** In-process sample entries past which expired ones are swept. */
const SWEEP_AT = 1000;

export interface ControlEventsOptions {
  /** Shares sampling across processes. */
  redis?: Redis | null | undefined;
  /** `redis` is shared (e.g. `redisHub`'s): `close` leaves it open. */
  sharedRedis?: boolean | undefined;
  /** Key prefix in Redis; default `manablox:controlEvents:sample:`. */
  prefix?: string | undefined;
  sampleSeconds?: number | undefined;
  now?: (() => number) | undefined;
}

/**
 * Writes control events to the outbox (`control_events`). `emit` with `tx` writes in the
 * cause's transaction; without one a failure is logged, never thrown. `sample` emits at most
 * one event per type, scope and key per hour.
 */
export class ControlEvents {
  /** Called once an event is committed, e.g. to push it. */
  onEmitted: (() => void) | null = null;
  private readonly sampled = new Map<string, number>();
  private readonly redis: Redis | null;
  private readonly sharedRedis: boolean;
  private readonly prefix: string;
  private readonly sampleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly manablox: Pick<Manablox, 'logger'>,
    private readonly repos: Repositories,
    options: ControlEventsOptions = {},
  ) {
    this.redis = options.redis ?? null;
    this.sharedRedis = options.sharedRedis === true;
    this.prefix = options.prefix ?? `${REDIS_PREFIX}controlEvents:sample:`;
    this.sampleMs = (options.sampleSeconds ?? CONTROL_EVENT_SAMPLE_SECONDS) * 1000;
    this.now = options.now ?? Date.now;
  }

  async emit(
    type: ControlEventType,
    scope: ControlScope,
    payload: Record<string, unknown> = {},
    options: ControlEmitOptions = {},
  ): Promise<void> {
    const { tx } = options;
    if (tx) {
      await tx.controlEvents.append({ type, scope, payload });
      await whenCommitted(tx as Repositories, () => this.emitted());
      return;
    }
    try {
      await this.repos.controlEvents.append({ type, scope, payload });
      this.emitted();
    } catch (error) {
      this.manablox.logger.warn(
        { err: error, type, scope: scopeLabel(scope) },
        'control event lost',
      );
    }
  }

  /**
   * Emits unless one of `type`, `scope` and `key` went out in the window (an hour by default).
   * Never rejects; callers on a hot path need not wait for it.
   */
  sample(
    type: ControlEventType,
    scope: ControlScope,
    key: string,
    payload: Record<string, unknown> = {},
    options: { seconds?: number } = {},
  ): Promise<void> {
    const ms = options.seconds !== undefined ? options.seconds * 1000 : this.sampleMs;
    return this.claim(`${type}:${scopeLabel(scope)}:${key}`, ms)
      .then((claimed) => (claimed ? this.emit(type, scope, payload) : undefined))
      .catch((error: unknown) =>
        this.manablox.logger.debug({ err: error, type }, 'control event not sampled'),
      );
  }

  async close(): Promise<void> {
    if (!this.sharedRedis) await this.redis?.quit().catch(() => {});
  }

  /**
   * Whether this caller is the first for `key` in the window: in process first, then across
   * processes with Redis `SET NX EX`.
   */
  private async claim(key: string, ms: number): Promise<boolean> {
    const now = this.now();
    const until = this.sampled.get(key);
    if (until !== undefined && until > now) return false;
    if (this.sampled.size >= SWEEP_AT) {
      for (const [entry, expires] of this.sampled) if (expires <= now) this.sampled.delete(entry);
    }
    this.sampled.set(key, now + ms);
    if (!this.redis) return true;
    const seconds = Math.max(1, Math.round(ms / 1000));
    return (await this.redis.set(`${this.prefix}${key}`, '1', 'EX', seconds, 'NX')) === 'OK';
  }

  private emitted(): void {
    try {
      this.onEmitted?.();
    } catch (error) {
      this.manablox.logger.debug({ err: error }, 'control event delivery not triggered');
    }
  }
}

/**
 * Deletes events older than the instance's `retention.controlEventsDays`, delivered or not;
 * `null` keeps them. Returns how many went.
 */
export async function pruneControlEvents(
  manablox: Pick<Manablox, 'controls'>,
  repos: Repositories,
  now: Date = new Date(),
): Promise<number> {
  const days = (await manablox.controls.resolved(null)).retention.controlEventsDays;
  if (days === null) return 0;
  return repos.controlEvents.pruneBefore(new Date(now.getTime() - days * 24 * 60 * 60_000));
}

const LEVELS: readonly UsageLevel[] = ['ok', 'warn', 'over', 'blocked'];

/** Seconds a `usage.threshold` key is kept; longer than any period. */
const THRESHOLD_ONCE_SECONDS = 40 * 24 * 60 * 60;

/**
 * Turns usage transitions into events: `usage.threshold` once per scope, metric, period and
 * threshold as usage rises, `limit.exceeded` when a soft usage limit is passed.
 */
export function usageTransitionEvents(events: ControlEvents): UsageTransitionHandler {
  return async (transition) => {
    const { scope, metric, from, to, threshold, used, max, period } = transition;
    const payload = { metric, used, max, period };
    if (threshold !== null && LEVELS.indexOf(to) >= LEVELS.indexOf(from)) {
      await events.sample(
        'usage.threshold',
        scope,
        `${metric}:${period}:${threshold}`,
        { ...payload, threshold, level: to },
        { seconds: THRESHOLD_ONCE_SECONDS },
      );
    }
    if (to === 'over' && (from === 'ok' || from === 'warn')) {
      await events.emit('limit.exceeded', scope, payload);
    }
  };
}
