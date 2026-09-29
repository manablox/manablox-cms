import { type createRedis, REDIS_PREFIX } from '@manablox/cache';
import {
  type AnyUsageMetric,
  type ControlScope,
  parseScopeLabel,
  purgeTags,
  scopeLabel,
  type UsageBlock,
  type UsageLevel,
  type UsageNotice,
  type UsageState,
  usageLevel,
  usageMetrics,
  usagePeriod,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { Repositories } from '@manablox/db';
import { providerCacheTags } from '../data/registry.js';
import { loadUsageSnapshot } from './usage-snapshot.js';

type Redis = ReturnType<typeof createRedis>;

/** How long a read state is used before it is read again. */
export const USAGE_STATE_TTL_MS = 5000;

/** Past this without a fresh read, enforcement fails open. */
export const USAGE_STATE_STALE_MS = 5 * 60_000;

/** A Redis read slower than this counts as failed. */
const READ_TIMEOUT_MS = 1000;

/** Where the transition baseline is kept, so a restart does not repeat transitions. */
export const USAGE_BASELINE_META_KEY = 'controls.usageState';

const LEVELS: readonly UsageLevel[] = ['ok', 'warn', 'over', 'blocked'];

/** Metrics whose block purges the space's cached deliveries. */
const PURGED_ON_BLOCK: ReadonlySet<AnyUsageMetric> = new Set(['apiRequests', 'bandwidthBytes']);

/** A metric's state at one scope, with what transitions compare. */
export interface ScopeUsageState extends UsageState {
  period: string;
  /** The highest threshold percent reached; `null` below every threshold. */
  threshold: number | null;
}

/** Metric states of one scope; a metric without a limit there is absent. */
export type ScopeUsage = Partial<Record<AnyUsageMetric, ScopeUsageState>>;

/** A change of level or of the highest threshold reached, in either direction. */
export interface UsageTransition {
  scope: ControlScope;
  metric: AnyUsageMetric;
  from: UsageLevel;
  to: UsageLevel;
  /** The highest threshold percent reached now; `null` below every threshold. */
  threshold: number | null;
  used: number;
  /** `null` once the scope has no limit for the metric. */
  max: number | null;
  period: string;
}

export type UsageTransitionHandler = (transition: UsageTransition) => void | Promise<void>;

type Baseline = Record<
  string,
  Partial<Record<AnyUsageMetric, { level: UsageLevel; threshold: number | null; period: string }>>
>;

export interface UsageStateOptions {
  /** Shares the evaluated state across processes. */
  redis?: Redis | null | undefined;
  /** Key prefix in Redis; default `manablox:controls:usage:`. */
  prefix?: string | undefined;
  /** The instance's `usagePeriodAnchorDay`. */
  anchorDay: () => Promise<number>;
  /** Keeps the transition baseline and fires transitions; one kind of process should. */
  owner: boolean;
  now?: (() => number) | undefined;
}

interface CachedScope {
  value: ScopeUsage;
  expires: number;
  /** When the value was last read or evaluated. */
  freshAt: number;
}

/**
 * The usage level per scope and metric (`ok`, `warn`, `over`, `blocked`) against the usage
 * limit set at that scope. `evaluate` computes it from `usage_counters` and `usage_external`
 * and stores it in Redis (`controls:usage:<scope>`, a hash of metric to state) or, without
 * Redis, in process. Reads are cached for 5 seconds; after 5 minutes without a fresh read the
 * state is ignored (fail-open).
 */
export class UsageStateStore {
  private readonly handlers = new Set<UsageTransitionHandler>();
  private readonly cache = new Map<string, CachedScope>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Without Redis: the last evaluation, and when it ran. */
  private local = new Map<string, ScopeUsage>();
  private localAt = 0;
  private evaluating: Promise<UsageTransition[]> | null = null;
  private staleLogged = false;
  private readonly redis: Redis | null;
  private readonly prefix: string;
  private readonly now: () => number;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    private readonly options: UsageStateOptions,
  ) {
    this.redis = options.redis ?? null;
    this.prefix = options.prefix ?? `${REDIS_PREFIX}controls:usage:`;
    this.now = options.now ?? Date.now;
  }

  /** Called for every transition an owner detects; returns an unsubscribe. */
  onTransition(handler: UsageTransitionHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Evaluates once now, off the caller's path; stopping waits for it. */
  start(): void {
    if (!this.options.owner && this.redis) return;
    const run = this.evaluate().catch((error: unknown) =>
      this.manablox.logger.warn({ err: error }, 'usage state not evaluated'),
    );
    this.manablox.hooks.on('before:stop', () => run.then(() => {}), { source: 'controls' });
  }

  /**
   * Recomputes every scope's state and stores it; an owner also compares it with the last
   * baseline and returns (and reports) the transitions. One run at a time per process.
   */
  evaluate(): Promise<UsageTransition[]> {
    const run = (this.evaluating ?? Promise.resolve([])).then(
      () => this.evaluateOnce(),
      () => this.evaluateOnce(),
    );
    this.evaluating = run.finally(() => {
      if (this.evaluating === run) this.evaluating = null;
    });
    return run;
  }

  /** The states of one scope, cached; `{}` when unknown or stale. */
  async scope(scope: ControlScope): Promise<ScopeUsage> {
    return (await this.scopes([scope])).get(scopeLabel(scope)) ?? {};
  }

  /** The states of several scopes by label; missing ones are read in one round trip. */
  async scopes(scopes: readonly ControlScope[]): Promise<Map<string, ScopeUsage>> {
    const labels = scopes.map(scopeLabel);
    const out = new Map<string, ScopeUsage>();
    if (!this.redis) {
      const fresh = this.fresh(this.localAt);
      for (const label of labels) out.set(label, fresh ? (this.local.get(label) ?? {}) : {});
      return out;
    }
    const now = this.now();
    const missing = labels.filter((label) => {
      const hit = this.cache.get(label);
      return !hit || hit.expires <= now;
    });
    if (missing.length > 0) await this.read(missing);
    for (const label of labels) {
      const hit = this.cache.get(label);
      out.set(label, hit && this.fresh(hit.freshAt) ? hit.value : {});
    }
    return out;
  }

  /** The first scope in `chain` where `metric` is blocked in the current period. */
  async blocked(
    chain: readonly ControlScope[],
    metric: AnyUsageMetric,
  ): Promise<UsageBlock | null> {
    const states = await this.scopes(chain);
    const now = this.now();
    for (const scope of chain) {
      const state = states.get(scopeLabel(scope))?.[metric];
      if (state?.level !== 'blocked' || state.max === null) continue;
      // A state left from an earlier period no longer blocks.
      if (Date.parse(state.resetsAt) <= now) continue;
      return { scope, used: state.used, max: state.max, resetsAt: state.resetsAt };
    }
    return null;
  }

  /** Per metric, the most severe level that is not `ok` across `chain`. */
  async notices(
    chain: readonly ControlScope[],
  ): Promise<Partial<Record<AnyUsageMetric, UsageNotice>>> {
    const states = await this.scopes(chain);
    const now = this.now();
    const out: Partial<Record<AnyUsageMetric, UsageNotice>> = {};
    for (const scope of chain) {
      const scopeState = states.get(scopeLabel(scope)) ?? {};
      for (const [metric, state] of Object.entries(scopeState) as [
        AnyUsageMetric,
        ScopeUsageState,
      ][]) {
        if (state.level === 'ok' || Date.parse(state.resetsAt) <= now) continue;
        const seen = out[metric];
        if (seen && LEVELS.indexOf(seen.level) >= LEVELS.indexOf(state.level)) continue;
        const { level, used, max, resetsAt } = state;
        out[metric] = { scope, level, used, max, resetsAt };
      }
    }
    return out;
  }

  private fresh(at: number): boolean {
    if (at === 0) return true;
    if (this.now() - at <= USAGE_STATE_STALE_MS) {
      this.staleLogged = false;
      return true;
    }
    if (!this.staleLogged) {
      this.staleLogged = true;
      this.manablox.logger.warn('usage state stale for 5 minutes; usage limits not enforced');
    }
    return false;
  }

  /** Reads scopes from Redis; on failure the last read values stay in use. */
  private async read(labels: string[]): Promise<void> {
    const key = labels.join(' ');
    const pending = this.loading.get(key);
    if (pending) return pending;
    const load = this.readOnce(labels).finally(() => this.loading.delete(key));
    this.loading.set(key, load);
    return load;
  }

  private async readOnce(labels: string[]): Promise<void> {
    const redis = this.redis;
    if (!redis) return;
    try {
      const pipeline = redis.pipeline();
      for (const label of labels) pipeline.hgetall(`${this.prefix}${label}`);
      const results = await withTimeout(pipeline.exec(), READ_TIMEOUT_MS);
      const now = this.now();
      labels.forEach((label, index) => {
        const [error, hash] = results?.[index] ?? [new Error('no reply'), null];
        if (error) throw error;
        this.cache.set(label, {
          value: parseHash(hash as Record<string, string>),
          expires: now + USAGE_STATE_TTL_MS,
          freshAt: now,
        });
      });
    } catch (error) {
      this.manablox.logger.debug({ err: error }, 'usage state not read; last state kept');
      const now = this.now();
      for (const label of labels) {
        const hit = this.cache.get(label);
        // A scope never read stays unknown, which admits everything.
        this.cache.set(label, {
          value: hit?.value ?? {},
          expires: now + USAGE_STATE_TTL_MS,
          freshAt: hit?.freshAt ?? now,
        });
      }
    }
  }

  private async evaluateOnce(): Promise<UsageTransition[]> {
    if (!this.options.owner) {
      this.publishLocal(await this.compute());
      return [];
    }
    const { states, transitions } = await this.repos.locks.withLock(
      'controls:usageState',
      async () => {
        const next = await this.compute();
        const baseline =
          (await this.repos.instanceMeta.get<Baseline>(USAGE_BASELINE_META_KEY)) ?? {};
        const changes = diff(baseline, next.states, next.period);
        if (changes.length > 0) {
          await this.repos.instanceMeta.set(USAGE_BASELINE_META_KEY, baselineOf(next.states));
        }
        await this.publish(next.states);
        return { states: next.states, transitions: changes };
      },
    );
    if (!this.redis) this.publishLocal({ states });
    for (const transition of transitions) await this.report(transition);
    return transitions;
  }

  private publishLocal(next: { states: Map<string, ScopeUsage> }): void {
    this.local = next.states;
    this.localAt = this.now();
  }

  /** Replaces every scope hash in Redis and this process's cache. */
  private async publish(states: Map<string, ScopeUsage>): Promise<void> {
    const redis = this.redis;
    if (!redis) return;
    const index = `${this.prefix}scopes`;
    const before: string[] = await redis.smembers(index);
    const multi = redis.multi();
    for (const label of before) if (!states.has(label)) multi.del(`${this.prefix}${label}`);
    multi.del(index);
    for (const [label, metrics] of states) {
      const key = `${this.prefix}${label}`;
      multi.del(key);
      const fields = Object.entries(metrics).flatMap(([metric, state]) => [
        metric,
        JSON.stringify(state),
      ]);
      if (fields.length > 0) multi.hset(key, ...fields);
      multi.sadd(index, label);
    }
    await multi.exec();
    const now = this.now();
    for (const label of before) {
      if (!states.has(label)) this.cache.set(label, { value: {}, expires: 0, freshAt: now });
    }
    for (const [label, value] of states) {
      this.cache.set(label, { value, expires: now + USAGE_STATE_TTL_MS, freshAt: now });
    }
  }

  /** Purges a newly blocked space's deliveries, then tells the handlers. */
  private async report(transition: UsageTransition): Promise<void> {
    if (transition.to === 'blocked' && PURGED_ON_BLOCK.has(transition.metric)) {
      await this.purge(transition.scope).catch((error: unknown) =>
        this.manablox.logger.warn({ err: error }, 'cache not purged for a blocked space'),
      );
    }
    this.manablox.logger.info(
      {
        scope: scopeLabel(transition.scope),
        metric: transition.metric,
        from: transition.from,
        to: transition.to,
        used: transition.used,
        max: transition.max,
      },
      'usage level changed',
    );
    for (const handler of this.handlers) {
      try {
        await handler(transition);
      } catch (error) {
        this.manablox.logger.warn({ err: error }, 'usage transition handler failed');
      }
    }
  }

  private async purge(scope: ControlScope): Promise<void> {
    const spaceIds =
      scope.kind === 'space'
        ? [scope.id]
        : scope.kind === 'group'
          ? await this.repos.spaceGroups.listSpaceIds(scope.id)
          : (await this.repos.spaces.list()).map((space) => space.id);
    for (const spaceId of spaceIds) {
      await purgeTags(this.manablox, spaceId, [
        `space:${spaceId}`,
        ...providerCacheTags(this.manablox, spaceId),
      ]);
    }
  }

  /** Every scope with a usage limit, against its spaces' counted and external usage. */
  private async compute(): Promise<{ states: Map<string, ScopeUsage>; period: string }> {
    const anchor = await this.options.anchorDay();
    const period = usagePeriod(new Date(this.now()), anchor);
    const resetsAt = period.end.toISOString();
    const snapshot = await loadUsageSnapshot(this.repos, period.label);
    const states = new Map<string, ScopeUsage>();
    for (const scope of snapshot.limitedScopes) {
      const scopeState: ScopeUsage = {};
      for (const metric of usageMetrics()) {
        const limit = snapshot.limitAt(scope, metric);
        if (!limit) continue;
        const used = snapshot.usedAt(scope, metric);
        const reached = limit.thresholds.filter((percent) => used * 100 >= limit.max * percent);
        scopeState[metric] = {
          level: usageLevel([limit], () => used),
          used,
          max: limit.max,
          resetsAt,
          period: period.label,
          threshold: reached.length > 0 ? Math.max(...reached) : null,
        };
      }
      states.set(scopeLabel(scope), scopeState);
    }
    return { states, period: period.label };
  }
}

/** Changes against the baseline; a baseline entry of an earlier period counts as `ok`. */
function diff(
  baseline: Baseline,
  states: Map<string, ScopeUsage>,
  period: string,
): UsageTransition[] {
  const out: UsageTransition[] = [];
  const labels = new Set([...Object.keys(baseline), ...states.keys()]);
  for (const label of labels) {
    const scope = parseScopeLabel(label);
    if (!scope) continue;
    const before = baseline[label] ?? {};
    const after = states.get(label) ?? {};
    const metrics = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<AnyUsageMetric>;
    for (const metric of metrics) {
      const previous = before[metric]?.period === period ? before[metric] : undefined;
      const next = after[metric];
      const from = previous?.level ?? 'ok';
      const to = next?.level ?? 'ok';
      const threshold = next?.threshold ?? null;
      if (from === to && (previous?.threshold ?? null) === threshold) continue;
      out.push({
        scope,
        metric,
        from,
        to,
        threshold,
        used: next?.used ?? 0,
        max: next?.max ?? null,
        period,
      });
    }
  }
  return out;
}

function baselineOf(states: Map<string, ScopeUsage>): Baseline {
  const out: Baseline = {};
  for (const [label, metrics] of states) {
    const entry: Baseline[string] = {};
    for (const [metric, state] of Object.entries(metrics) as [AnyUsageMetric, ScopeUsageState][]) {
      entry[metric] = { level: state.level, threshold: state.threshold, period: state.period };
    }
    out[label] = entry;
  }
  return out;
}

function parseHash(hash: Record<string, string> | null): ScopeUsage {
  const out: ScopeUsage = {};
  for (const [metric, raw] of Object.entries(hash ?? {})) {
    try {
      out[metric as AnyUsageMetric] = JSON.parse(raw) as ScopeUsageState;
    } catch {
      // A malformed entry is skipped.
    }
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('usage state read timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
