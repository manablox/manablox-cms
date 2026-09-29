/** Named rate limit rules: counted hits, concurrency slots, and work retried later. */

import type { PluginControlSuffix, RateRuleKey } from './catalogue.js';
import type { ResolvedControls } from './resolve.js';
import type { ConcurrencyRule, RateRule } from './types.js';

/** Rules that cap how many run at once; a plugin's are `plugins.<id>.<name>` declared `concurrency`. */
export type ConcurrencyRuleName = 'uploads.parallel' | PluginControlSuffix;

/** Rules that count hits per window; a plugin's are `plugins.<id>.<name>`. */
export type RateLimitRuleName =
  | Exclude<RateRuleKey, ConcurrencyRuleName | 'graphql.depth' | 'graphql.complexity'>
  | PluginControlSuffix;

/** One bucket to count a hit in: at most `max` per `window` milliseconds. */
export interface RateCheck {
  key: string;
  max: number;
  window: number;
}

/** A store's answer to a batch of checks; a refused batch counts nothing. */
export interface RateOutcome {
  allowed: boolean;
  /** The check that decided: the refusing one, else the one with the least left. */
  index: number;
  limit: number;
  remaining: number;
  /** Milliseconds until the deciding bucket has room again (refused) or its window ends. */
  reset: number;
}

/** Sliding-window counters and concurrency slots, in process or shared through Redis. */
export interface RateStore {
  consume(checks: readonly RateCheck[]): Promise<RateOutcome> | RateOutcome;
  /** Takes a slot of at most `max`, held for `ttl` milliseconds at most; `null` when full. */
  acquire(key: string, max: number, ttl: number): Promise<string | null> | string | null;
  release(key: string, token: string): Promise<void> | void;
}

/** Failures allowed before the backoff starts, how long they are remembered, and its cap. */
export interface BackoffPolicy {
  attempts: number;
  window: number;
  maxDelay: number;
}

/** Rate counters, concurrency slots and failure backoff; in process or shared through Redis. */
export interface RateLimitStore extends RateStore {
  /** Milliseconds the longest blocked key still waits; 0 when none is blocked. */
  blocked(keys: readonly string[]): Promise<number> | number;
  /** Counts a failure per key; past `attempts` each blocks for 1 s, 2 s, 4 s ... up to `maxDelay`. */
  fail(keys: readonly string[], policy: BackoffPolicy): Promise<void> | void;
  clear(keys: readonly string[]): Promise<void> | void;
  close?(): Promise<void>;
}

/** Block duration after `failures` consecutive failures. */
export function backoffFor(failures: number, attempts: number, maxDelay: number): number {
  if (failures <= attempts) return 0;
  return Math.min(maxDelay, 1_000 * 2 ** (failures - attempts - 1));
}

/**
 * Sliding-window counter: this window's count plus the previous window's, weighted by how much
 * of it still overlaps. `retryIn` is when the weighted count drops below `max` again.
 */
function slide(
  state: { index: number; current: number; previous: number } | undefined,
  now: number,
  window: number,
): { index: number; current: number; previous: number; used: number; elapsed: number } {
  const index = Math.floor(now / window);
  let current = 0;
  let previous = 0;
  if (state?.index === index) {
    current = state.current;
    previous = state.previous;
  } else if (state?.index === index - 1) {
    previous = state.current;
  }
  const elapsed = now - index * window;
  const used = (previous * (window - elapsed)) / window + current;
  return { index, current, previous, used, elapsed };
}

function retryIn(
  max: number,
  window: number,
  slid: { current: number; previous: number; elapsed: number },
): number {
  if (max <= 0) return window - slid.elapsed;
  const room = max - 1;
  if (slid.current <= room) {
    // Waits for the previous window's share to fade.
    const needed = window - ((room - slid.current) * window) / slid.previous;
    return Math.max(1, Math.ceil(needed - slid.elapsed));
  }
  // Waits into the next window, where this one's count fades.
  const needed = window - (room * window) / slid.current;
  return Math.max(1, Math.ceil(window - slid.elapsed + needed));
}

/** The check with the least room left decides an allowed batch. */
function allowedOutcome(
  checks: readonly RateCheck[],
  remaining: number[],
  resets: number[],
): RateOutcome {
  let index = 0;
  for (let i = 1; i < checks.length; i++) {
    if ((remaining[i] ?? 0) < (remaining[index] ?? 0)) index = i;
  }
  return {
    allowed: true,
    index,
    limit: checks[index]?.max ?? 0,
    remaining: remaining[index] ?? 0,
    reset: resets[index] ?? 0,
  };
}

/** A store answering synchronously. */
export interface MemoryRateLimitStore extends RateLimitStore {
  consume(checks: readonly RateCheck[]): RateOutcome;
  acquire(key: string, max: number, ttl: number): string | null;
  release(key: string, token: string): void;
  blocked(keys: readonly string[]): number;
  fail(keys: readonly string[], policy: BackoffPolicy): void;
  clear(keys: readonly string[]): void;
}

/** Counters, slots and backoff in Maps, swept every minute so they cannot grow unbounded. */
export function memoryRateLimitStore(options: { now?: () => number } = {}): MemoryRateLimitStore {
  const now = options.now ?? Date.now;
  const buckets = new Map<
    string,
    { index: number; current: number; previous: number; window: number }
  >();
  const slots = new Map<string, Map<string, number>>();
  const backoff = new Map<string, { failures: number; until: number; expires: number }>();

  const sweep = () => {
    const at = now();
    for (const [key, bucket] of buckets) {
      if (at >= (bucket.index + 2) * bucket.window) buckets.delete(key);
    }
    for (const [key, held] of slots) {
      for (const [token, expires] of held) if (expires <= at) held.delete(token);
      if (held.size === 0) slots.delete(key);
    }
    for (const [key, entry] of backoff) if (entry.expires < at) backoff.delete(key);
  };
  const timer = setInterval(sweep, 60_000);
  timer.unref?.();

  return {
    consume(checks) {
      const at = now();
      const slid = checks.map((check) => slide(buckets.get(check.key), at, check.window));
      for (const [i, check] of checks.entries()) {
        const state = slid[i];
        if (!state || state.used + 1 <= check.max) continue;
        return {
          allowed: false,
          index: i,
          limit: check.max,
          remaining: 0,
          reset: retryIn(check.max, check.window, state),
        };
      }
      const remaining: number[] = [];
      const resets: number[] = [];
      for (const [i, check] of checks.entries()) {
        const state = slid[i] as ReturnType<typeof slide>;
        buckets.set(check.key, {
          index: state.index,
          current: state.current + 1,
          previous: state.previous,
          window: check.window,
        });
        remaining.push(Math.max(0, Math.floor(check.max - state.used - 1)));
        resets.push(check.window - state.elapsed);
      }
      return allowedOutcome(checks, remaining, resets);
    },
    acquire(key, max, ttl) {
      const at = now();
      const held = slots.get(key) ?? new Map<string, number>();
      for (const [token, expires] of held) if (expires <= at) held.delete(token);
      if (held.size >= max) return null;
      const token = crypto.randomUUID();
      held.set(token, at + ttl);
      slots.set(key, held);
      return token;
    },
    release(key, token) {
      slots.get(key)?.delete(token);
    },
    blocked(keys) {
      const at = now();
      let longest = 0;
      for (const key of keys) {
        const entry = backoff.get(key);
        if (!entry || entry.expires < at) continue;
        longest = Math.max(longest, entry.until - at);
      }
      return longest;
    },
    fail(keys, policy) {
      const at = now();
      for (const key of keys) {
        const held = backoff.get(key);
        const failures = (held && held.expires >= at ? held.failures : 0) + 1;
        const until = at + backoffFor(failures, policy.attempts, policy.maxDelay);
        backoff.set(key, { failures, until, expires: Math.max(at + policy.window, until) });
      }
    },
    clear(keys) {
      for (const key of keys) backoff.delete(key);
    },
    async close() {
      clearInterval(timer);
      buckets.clear();
      slots.clear();
      backoff.clear();
    },
  };
}

/** A hit to count against a rule. `fallback` replaces the catalogue default while no scope sets the rule. */
export interface RateHit {
  rule: RateLimitRuleName;
  key: string;
  fallback?: RateRule | null | undefined;
}

/** The outcome of the deciding rule; times in whole seconds. */
export interface RateDecision {
  rule: RateLimitRuleName;
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
}

/** A taken slot. */
export interface RateSlot {
  release(): Promise<void>;
}

/** The rule in effect: a value some scope sets, else `fallback` when given, else the default. */
export function effectiveRateRule<K extends RateLimitRuleName | ConcurrencyRuleName>(
  resolved: ResolvedControls,
  rule: K,
  fallback?: RateRule | ConcurrencyRule | null | undefined,
): ResolvedControls['rateLimits'][K] {
  if (fallback !== undefined && !resolved.rateLimitScopes?.[rule]) {
    return fallback as ResolvedControls['rateLimits'][K];
  }
  return resolved.rateLimits[rule];
}

/**
 * Counts `hits` whose rule has a limit in one store call. `null` when none has one or the
 * store failed (`onError` gets the error).
 */
export async function consumeRate(
  store: RateStore,
  resolved: ResolvedControls,
  hits: readonly RateHit[],
  onError: (error: unknown) => void,
): Promise<RateDecision | null> {
  const checks: RateCheck[] = [];
  const rules: RateLimitRuleName[] = [];
  for (const hit of hits) {
    const rule = effectiveRateRule(resolved, hit.rule, hit.fallback);
    if (!rule) continue;
    const window = rule.windowSeconds * 1000;
    // The window is part of the key, so a changed rule starts a fresh count.
    checks.push({ key: `${hit.rule}:${window}:${hit.key}`, max: rule.max, window });
    rules.push(hit.rule);
  }
  const first = rules[0];
  if (!first) return null;
  try {
    const outcome = await store.consume(checks);
    const seconds = Math.max(1, Math.ceil(outcome.reset / 1000));
    return {
      rule: rules[outcome.index] ?? first,
      allowed: outcome.allowed,
      limit: outcome.limit,
      remaining: outcome.remaining,
      reset: seconds,
      retryAfter: outcome.allowed ? 0 : seconds,
    };
  } catch (error) {
    onError(error);
    return null;
  }
}

/**
 * A slot under `rule`, pooled at the scope that sets it; `null` when all are taken. Without
 * a limit, or when the store fails, a slot that holds nothing.
 */
export async function acquireSlot(
  store: RateStore,
  resolved: ResolvedControls,
  rule: ConcurrencyRuleName,
  ttl: number,
  onError: (error: unknown) => void,
): Promise<RateSlot | null> {
  const free: RateSlot = { release: async () => {} };
  const max = resolved.rateLimits[rule]?.max;
  if (max === undefined) return free;
  const scope = resolved.rateLimitScopes?.[rule] ?? { kind: 'instance' as const };
  const key = `${rule}:${scope.kind === 'instance' ? 'instance' : `${scope.kind}:${scope.id}`}`;
  try {
    const token = await store.acquire(key, max, ttl);
    if (token === null) return null;
    return {
      release: async () => {
        try {
          await store.release(key, token);
        } catch (error) {
          onError(error);
        }
      },
    };
  } catch (error) {
    onError(error);
    return free;
  }
}

/** A config limit (`window` in milliseconds) as a rule; `false` is none. */
export function configRateRule(
  config: { window: number; max: number } | false | undefined,
): RateRule | null | undefined {
  if (config === undefined) return undefined;
  if (config === false) return null;
  return { max: config.max, windowSeconds: Math.max(1, Math.ceil(config.window / 1000)) };
}

/** Thrown by queued work that has to wait, e.g. for a concurrency slot; the queue runs it again after `delay` ms. */
export class RetryLater extends Error {
  constructor(
    readonly delay: number,
    reason = 'retry later',
  ) {
    super(reason);
    this.name = 'RetryLater';
  }

  static is(error: unknown): error is RetryLater {
    return (
      error instanceof Error &&
      error.name === 'RetryLater' &&
      typeof (error as RetryLater).delay === 'number'
    );
  }
}
