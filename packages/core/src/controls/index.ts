/** Controls: feature flags, limits, usage and settings set by the control API, per scope. */

import type { Scope } from '../environment.js';
import {
  type AnyLimitKey,
  type AnyUsageMetric,
  controlEntry,
  type FeatureKey,
  featureControlKey,
  limitControlKey,
} from './catalogue.js';
import { type FeatureCeilings, type FeatureCeilingValues, NO_CEILINGS } from './ceilings.js';
import { featureDenied, rateLimitExceeded } from './errors.js';
import type { ControlEmitOptions, ControlEventType } from './events.js';
import {
  acquireSlot,
  type ConcurrencyRuleName,
  consumeRate,
  memoryRateLimitStore,
  type RateDecision,
  type RateHit,
  type RateSlot,
  type RateStore,
} from './rate.js';
import {
  type LimitBreach,
  type ResolvedControls,
  resolveAll,
  resolveFeature,
  resolveLimits,
  scopeChain,
} from './resolve.js';
import type {
  ControlScope,
  FeatureControl,
  LimitControl,
  LimitIncrement,
  ResolvedFeature,
  ResolvedLimit,
  UsageBlock,
  UsageNotice,
} from './types.js';

export * from './catalogue.js';
export * from './ceilings.js';
export * from './errors.js';
export * from './events.js';
export * from './period.js';
export * from './rate.js';
export * from './resolve.js';
export * from './types.js';
export type { ControlIssue } from './validators.js';

/** What services ask; `spaceId: null` is the instance alone. */
export interface Controls {
  feature(spaceId: string | null, key: FeatureKey): Promise<ResolvedFeature>;
  /** Every scope's limit for the key; all must pass. */
  limit(spaceId: string | null, key: AnyLimitKey): Promise<ResolvedLimit[]>;
  /** Throws `control.feature` when the feature is off. */
  assertFeature(spaceId: string | null, key: FeatureKey): Promise<void>;
  /**
   * Throws `control.limit` when `used + increment` passes a hard limit; returns the soft
   * limits it passes. A scope with an increment of 0 passes, and so does anything created in
   * a staging environment.
   */
  assertLimit(
    spaceId: Scope | null,
    key: AnyLimitKey,
    options?: { increment?: LimitIncrement },
  ): Promise<LimitBreach[]>;
  /** Counts usage; batched, never blocks the caller. `null` counts it unattributed. */
  consume(spaceId: string | null, metric: AnyUsageMetric, amount: number): void;
  /** The hard usage limit the space (the instance with `null`) is blocked by, if any. */
  usageBlocked(spaceId: string | null, metric: AnyUsageMetric): Promise<UsageBlock | null>;
  /** Throws `control.usage` while `usageBlocked` finds a block. */
  assertUsage(spaceId: string | null, metric: AnyUsageMetric): Promise<void>;
  /** Metrics that are not `ok` for the space (the instance with `null`), most severe scope. */
  usageNotices(spaceId: string | null): Promise<Partial<Record<AnyUsageMetric, UsageNotice>>>;
  resolved(spaceId: string | null): Promise<ResolvedControls>;
  /**
   * Counts one hit per rule that has a limit, in one store call; a refused call counts
   * nothing. `null` when no rule has a limit or the store failed.
   */
  rate(spaceId: string | null, hits: readonly RateHit[]): Promise<RateDecision | null>;
  /** `rate`, throwing `rateLimit.exceeded` when refused. */
  assertRate(spaceId: string | null, hits: readonly RateHit[]): Promise<RateDecision | null>;
  /**
   * A slot under a concurrency rule, counted at the scope that sets it; `null` when all are
   * taken. Held for `ttl` milliseconds at most.
   */
  acquire(spaceId: string | null, rule: ConcurrencyRuleName, ttl: number): Promise<RateSlot | null>;
  /**
   * Throws `control.readOnly` or `control.suspended` unless the space (or instance) is active;
   * `control.readOnly` also while a promote writes the space's production environment (a
   * space id alone means production).
   */
  assertWritable(scope: Scope | null): Promise<void>;
  /**
   * Records an event for the external layer. With `tx` it is written in that transaction and
   * a failure fails it; without, a failure is only logged.
   */
  emit(
    type: ControlEventType,
    scope: ControlScope,
    payload?: Record<string, unknown>,
    options?: ControlEmitOptions,
  ): Promise<void>;
}

/** Catalogue defaults under the ceilings, if given: no stored values, no counts. */
export class DefaultControls implements Controls {
  private cached: ResolvedControls | null = null;
  private cachedCeilings: FeatureCeilingValues = NO_CEILINGS;
  private store: RateStore | null = null;

  constructor(private readonly ceilings: FeatureCeilings | null = null) {}

  /** Rate counters in this process, with the catalogue defaults. */
  private get rates(): RateStore {
    this.store ??= memoryRateLimitStore();
    return this.store;
  }

  async feature(spaceId: string | null, key: FeatureKey): Promise<ResolvedFeature> {
    const fallback = entryDefault<FeatureControl>(featureControlKey(key)) ?? { enabled: true };
    const ceiling = this.ceilings?.current().features.get(key);
    return resolveFeature(
      [
        ...(ceiling ? [{ scope: { kind: 'ceiling' } as const, value: ceiling }] : []),
        ...scopeChain(spaceId).map((scope) => ({ scope, value: undefined })),
      ],
      fallback,
    );
  }

  async limit(spaceId: string | null, key: AnyLimitKey): Promise<ResolvedLimit[]> {
    const fallback = entryDefault<LimitControl>(limitControlKey(key)) ?? {
      max: null,
      mode: 'hard',
    };
    return resolveLimits(
      scopeChain(spaceId).map((scope) => ({ scope, value: undefined })),
      fallback,
    );
  }

  async assertFeature(spaceId: string | null, key: FeatureKey): Promise<void> {
    const feature = await this.feature(spaceId, key);
    if (!feature.enabled) throw featureDenied(key, feature);
  }

  /** Without counts no limit can be checked; every default is unlimited. */
  async assertLimit(): Promise<LimitBreach[]> {
    return [];
  }

  consume(): void {}

  /** Nothing records events without a store. */
  async emit(): Promise<void> {}

  async usageBlocked(_spaceId: string | null, _metric: AnyUsageMetric): Promise<UsageBlock | null> {
    return null;
  }

  async assertUsage(_spaceId: string | null, _metric: AnyUsageMetric): Promise<void> {}

  async usageNotices(
    _spaceId: string | null,
  ): Promise<Partial<Record<AnyUsageMetric, UsageNotice>>> {
    return {};
  }

  /** Always active without stored values. */
  async assertWritable(_scope: Scope | null): Promise<void> {}

  async rate(spaceId: string | null, hits: readonly RateHit[]): Promise<RateDecision | null> {
    return consumeRate(this.rates, await this.resolved(spaceId), hits, () => {});
  }

  async assertRate(spaceId: string | null, hits: readonly RateHit[]): Promise<RateDecision | null> {
    const decision = await this.rate(spaceId, hits);
    if (decision && !decision.allowed) throw rateLimitExceeded(decision.rule, decision.retryAfter);
    return decision;
  }

  async acquire(
    spaceId: string | null,
    rule: ConcurrencyRuleName,
    ttl: number,
  ): Promise<RateSlot | null> {
    return acquireSlot(this.rates, await this.resolved(spaceId), rule, ttl, () => {});
  }

  async resolved(spaceId: string | null): Promise<ResolvedControls> {
    const ceilings = this.ceilings?.current() ?? NO_CEILINGS;
    if (!this.cached || ceilings !== this.cachedCeilings) {
      this.cached = resolveAll([{ scope: { kind: 'instance' }, values: {} }], {}, ceilings);
      this.cachedCeilings = ceilings;
    }
    return { ...structuredClone(this.cached), scopes: scopeChain(spaceId) };
  }
}

function entryDefault<T>(key: string): T | undefined {
  return controlEntry(key)?.default as T | undefined;
}
