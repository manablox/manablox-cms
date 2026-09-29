import type { TaggedCache } from '@manablox/cache';
import {
  type AnyLimitKey,
  type AnyUsageMetric,
  acquireSlot,
  type ConcurrencyRuleName,
  type ControlEmitOptions,
  type ControlEventType,
  type ControlScope,
  type Controls,
  checkLimits,
  consumeRate,
  type FeatureCeilingValues,
  type FeatureKey,
  featureControlKey,
  featureDenied,
  type LimitBreach,
  type LimitControl,
  type LimitIncrement,
  type LimitTarget,
  limitControlKey,
  limitReached,
  memoryRateLimitStore,
  promoteRefused,
  type RateDecision,
  type RateHit,
  type RateSlot,
  type RateStore,
  type ResolvedControls,
  type ResolvedFeature,
  type ResolvedLimit,
  rateLimitExceeded,
  resolveAll,
  resolveControl,
  resolveLimits,
  type Scope,
  type ScopeValues,
  scopeChain,
  scopeLabel,
  scopeSpaceId,
  stateRefusal,
  type UsageBlock,
  type UsageNotice,
  usageExceeded,
} from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { ControlSettingRow, Repositories, UsageSpaces } from '@manablox/db';
import { isStaging } from '../lib.js';
import type { ControlEvents } from './events.js';
import type { PromoteLocks } from './promote-lock.js';
import type { UsageStateStore } from './usage-state.js';

/** Seconds a resolved value is kept, in process and in the shared cache. */
export const CONTROLS_TTL_SECONDS = 5;

const INSTANCE_TAG = 'controls:instance';

/** A space's promote marker changed. */
const PROMOTE_TAG = /^controls:promote:/;

/** In-process entries past which expired ones are swept on the next store. */
const SWEEP_AT = 1000;

/** The cache tag of a scope; a write to the scope purges it. */
export function controlScopeTag(scope: ControlScope): string {
  return scope.kind === 'instance' ? INSTANCE_TAG : `controls:${scope.kind}:${scope.id}`;
}

/** What a limit counter counts over: one space, a group's spaces, or all of them. */
export interface LimitCountTarget extends LimitTarget {
  spaceIds: UsageSpaces;
}

/** Counts what a limit key limits, at one scope. */
export type LimitCounter = (target: LimitCountTarget) => Promise<number>;

/** Tells other processes which tags went stale. */
export interface ControlInvalidation {
  publish(key: string): void;
}

interface Entry<T> {
  value: T;
  expires: number;
}

interface ResolvedEntry extends Entry<ResolvedControls> {
  groupId: string | null;
  /** Loaded while no scope stored anything; any write drops it. */
  empty: boolean;
  /** The ceilings' version it was resolved under; another one drops it. */
  ceilings: string;
}

/** Where `consume` counts, see `UsageMeter`. */
export interface UsageSink {
  consume(spaceId: string | null, metric: AnyUsageMetric, amount: number): void;
  flush(): Promise<void>;
}

export interface ControlStoreOptions {
  /** Shared across processes, e.g. Redis; values stay in it for the same TTL. */
  shared?: TaggedCache | null | undefined;
  /** Milliseconds; defaults to `CONTROLS_TTL_SECONDS`. */
  ttl?: number | undefined;
  /** Rate counters and concurrency slots; in process by default. */
  rates?: RateStore | undefined;
}

/**
 * Controls read from `control_settings`, resolved per space under this process's feature
 * ceilings. The stored values are cached for a few seconds in the shared cache, the resolved
 * ones in process per ceiling version; ceilings never reach the shared cache. Writes call
 * `invalidate` with the tags of their scopes.
 */
export class ControlStore implements Controls {
  private readonly resolvedCache = new Map<string, ResolvedEntry>();
  private readonly groups = new Map<string, Entry<string | null>>();
  private readonly loading = new Map<string, Promise<ResolvedControls>>();
  private readonly counters = new Map<AnyLimitKey, LimitCounter>();
  /** Defaults of plugin flags no scope sets, per resolved value (which is never changed). */
  private readonly unsetFeatures = new WeakMap<
    ResolvedControls,
    Map<FeatureKey, ResolvedFeature>
  >();
  private emptyState: Entry<boolean> | null = null;
  /** Counts `consume`; nothing is counted without one. */
  usage: UsageSink | null = null;
  /** Records control events; nothing is recorded without one. */
  events: ControlEvents | null = null;
  /** Evaluated usage levels; nothing is blocked without one. */
  usageState: UsageStateStore | null = null;
  /** Running promotes; production writes are refused during one. */
  promotes: PromoteLocks | null = null;
  /** Moves on every invalidation, so a load that started before it is not kept. */
  private generation = 0;
  private bus: ControlInvalidation | null = null;
  private readonly shared: TaggedCache | null;
  private readonly ttl: number;
  private rateStore: RateStore | null;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    options: ControlStoreOptions = {},
  ) {
    this.shared = options.shared ?? null;
    this.ttl = options.ttl ?? CONTROLS_TTL_SECONDS * 1000;
    this.rateStore = options.rates ?? null;
  }

  /** Where rate hits and slots are counted; Redis when replicas share it. */
  get rates(): RateStore {
    if (!this.rateStore) {
      const store = memoryRateLimitStore();
      this.manablox.onDispose(() => store.close?.());
      this.rateStore = store;
    }
    return this.rateStore;
  }

  set rates(store: RateStore) {
    this.rateStore = store;
  }

  /** Announces invalidations to other processes. */
  connect(bus: ControlInvalidation | null): void {
    this.bus = bus;
  }

  /**
   * Counts `key` for `assertLimit`; a key without a counter always passes. The returned
   * function restores the previous counter.
   */
  registerLimitCounter(key: AnyLimitKey, counter: LimitCounter): () => void {
    const previous = this.counters.get(key);
    this.counters.set(key, counter);
    return () => {
      if (this.counters.get(key) !== counter) return;
      if (previous) this.counters.set(key, previous);
      else this.counters.delete(key);
    };
  }

  async resolved(spaceId: string | null): Promise<ResolvedControls> {
    const key = spaceId ?? 'instance';
    const ceilings = this.manablox.ceilings.current();
    const hit = this.resolvedCache.get(key);
    if (hit && hit.expires > Date.now() && hit.ceilings === ceilings.version) return hit.value;
    const loadKey = `${key} ${ceilings.version}`;
    const pending = this.loading.get(loadKey);
    if (pending) return pending;
    const load = this.load(key, spaceId, ceilings).finally(() => {
      if (this.loading.get(loadKey) === load) this.loading.delete(loadKey);
    });
    this.loading.set(loadKey, load);
    return load;
  }

  /**
   * The resolved controls of many spaces at once: a space whose own scopes (the space, its
   * group) store nothing resolves like the instance, so only the others are resolved one by
   * one. For sweeps over every space.
   */
  async resolvedEach(
    spaces: ReadonlyArray<{ id: string; groupId: string | null }>,
  ): Promise<Map<string, ResolvedControls>> {
    const instance = await this.resolved(null);
    const stored = spaces.length ? await this.repos.controlSettings.storedScopes() : [];
    const own = new Set(stored.map((scope) => `${scope.kind}:${scope.id}`));
    const out = new Map<string, ResolvedControls>();
    for (const space of spaces) {
      const controlled =
        own.has(`space:${space.id}`) ||
        (space.groupId !== null && own.has(`group:${space.groupId}`));
      out.set(space.id, controlled ? await this.resolved(space.id) : instance);
    }
    return out;
  }

  async feature(spaceId: string | null, key: FeatureKey): Promise<ResolvedFeature> {
    const resolved = await this.resolved(spaceId);
    const found = (resolved.features as Partial<Record<FeatureKey, ResolvedFeature>>)[key];
    if (found) return found;
    // A plugin flag no scope or ceiling sets: its default, worked out once per resolved value.
    let unset = this.unsetFeatures.get(resolved);
    if (!unset) {
      unset = new Map();
      this.unsetFeatures.set(resolved, unset);
    }
    let feature = unset.get(key);
    if (!feature) {
      feature = deepFreeze(
        resolveControl(
          featureControlKey(key) as `features.plugins.${string}`,
          resolved.scopes.map((scope) => ({ scope, value: undefined })),
        ) as ResolvedFeature,
      );
      unset.set(key, feature);
    }
    return feature;
  }

  async limit(spaceId: string | null, key: AnyLimitKey): Promise<ResolvedLimit[]> {
    return (await this.resolved(spaceId)).limits[key] ?? [];
  }

  async assertFeature(spaceId: string | null, key: FeatureKey): Promise<void> {
    const feature = await this.feature(spaceId, key);
    if (!feature.enabled) {
      void this.events?.sample('feature.denied', scopeOf(spaceId), key, { feature: key, spaceId });
      throw featureDenied(key, feature);
    }
  }

  async assertLimit(
    scope: Scope | null,
    key: AnyLimitKey,
    options: { increment?: LimitIncrement } = {},
  ): Promise<LimitBreach[]> {
    // Staging rows count toward no limit.
    if (scope !== null && (await isStaging(this.repos, scope))) return [];
    const spaceId = scope === null ? null : scopeSpaceId(scope);
    const limits = await this.limit(spaceId, key);
    const counter = this.counters.get(key);
    if (limits.length === 0 || !counter) return [];
    const increment = options.increment ?? 1;
    const used = new Map<string, number>();
    const added = new Map<string, number>();
    await Promise.all(
      limits.map(async ({ scope }) => {
        const target = await this.countTarget(scope, spaceId);
        const label = scopeLabel(scope);
        added.set(label, typeof increment === 'number' ? increment : await increment(target));
        // Nothing added here: nothing to count.
        if ((added.get(label) ?? 0) > 0) used.set(label, await counter(target));
      }),
    );
    const { hard, soft } = checkLimits(
      limits,
      (scope) => used.get(scopeLabel(scope)) ?? 0,
      (scope) => added.get(scopeLabel(scope)) ?? 0,
    );
    if (hard) {
      void this.events?.sample('limit.blocked', hard.limit.scope, key, {
        limit: key,
        used: hard.used,
        max: hard.limit.max,
        spaceId,
      });
      throw limitReached(key, hard.limit.scope, hard.used, hard.limit.max);
    }
    for (const breach of soft) {
      this.onSoftBreach(key, breach, added.get(scopeLabel(breach.limit.scope)) ?? 0, spaceId);
    }
    return soft;
  }

  /**
   * `assertLimit` against the limit stored at one scope alone, for an action that adds to a
   * scope the space does not resolve through yet, e.g. the group it joins.
   */
  async assertLimitAt(
    scope: ControlScope,
    key: AnyLimitKey,
    increment: number,
  ): Promise<LimitBreach[]> {
    const counter = this.counters.get(key);
    if (!counter || increment <= 0) return [];
    const stored = (await this.repos.controlSettings.listByScope(scope)).find(
      (row) => row.key === limitControlKey(key),
    )?.value as LimitControl | undefined;
    const limits = resolveLimits([{ scope, value: stored }], { max: null, mode: 'off' });
    if (limits.length === 0) return [];
    const used = await counter(await this.countTarget(scope, null));
    const { hard, soft } = checkLimits(limits, () => used, increment);
    if (hard) {
      void this.events?.sample('limit.blocked', hard.limit.scope, key, {
        limit: key,
        used: hard.used,
        max: hard.limit.max,
        spaceId: null,
      });
      throw limitReached(key, hard.limit.scope, hard.used, hard.limit.max);
    }
    for (const breach of soft) this.onSoftBreach(key, breach, increment, null);
    return soft;
  }

  /** A soft limit passed; the action goes ahead. The action that crosses the max emits. */
  private onSoftBreach(
    key: AnyLimitKey,
    breach: LimitBreach,
    added: number,
    spaceId: string | null,
  ): void {
    if (breach.used <= breach.limit.max) {
      const { scope, max } = breach.limit;
      // Not awaited: the caller may hold a transaction.
      void this.emit('limit.exceeded', scope, {
        limit: key,
        used: breach.used + added,
        max,
        spaceId,
      });
    }
    this.manablox.logger.info(
      {
        limit: key,
        scope: scopeLabel(breach.limit.scope),
        used: breach.used,
        max: breach.limit.max,
      },
      'soft limit passed',
    );
  }

  consume(spaceId: string | null, metric: AnyUsageMetric, amount: number): void {
    this.usage?.consume(spaceId, metric, amount);
  }

  async emit(
    type: ControlEventType,
    scope: ControlScope,
    payload?: Record<string, unknown>,
    options?: ControlEmitOptions,
  ): Promise<void> {
    await this.events?.emit(type, scope, payload, options);
  }

  async usageBlocked(spaceId: string | null, metric: AnyUsageMetric): Promise<UsageBlock | null> {
    if (!this.usageState) return null;
    const resolved = await this.resolved(spaceId);
    // No scope of the space limits the metric.
    if (!resolved.usage.limits[metric]?.length) return null;
    return this.usageState.blocked(resolved.scopes, metric);
  }

  async usageNotices(
    spaceId: string | null,
  ): Promise<Partial<Record<AnyUsageMetric, UsageNotice>>> {
    if (!this.usageState) return {};
    const resolved = await this.resolved(spaceId);
    if (Object.values(resolved.usage.limits).every((limits) => !limits?.length)) return {};
    return this.usageState.notices(resolved.scopes);
  }

  async assertUsage(spaceId: string | null, metric: AnyUsageMetric): Promise<void> {
    const block = await this.usageBlocked(spaceId, metric);
    if (!block) return;
    void this.events?.sample('limit.blocked', block.scope, `usage.${metric}`, {
      metric,
      used: block.used,
      max: block.max,
      spaceId,
    });
    throw usageExceeded(metric, block.scope, block.used, block.max, block.resetsAt);
  }

  async assertWritable(scope: Scope | null): Promise<void> {
    const spaceId = scope === null ? null : scopeSpaceId(scope);
    const refusal = stateRefusal((await this.resolved(spaceId)).state);
    if (refusal) throw refusal;
    if (scope === null || spaceId === null || !this.promotes) return;
    const promote = await this.promotes.held(spaceId);
    if (!promote) return;
    const production =
      typeof scope === 'string' ||
      ('production' in scope
        ? scope.production === true
        : scope.environmentId === promote.productionId);
    if (production) throw promoteRefused(spaceId);
  }

  /** Tells the other processes a space's promote marker changed. */
  announcePromote(spaceId: string): void {
    this.bus?.publish(`controls:promote:${spaceId}`);
  }

  async rate(spaceId: string | null, hits: readonly RateHit[]): Promise<RateDecision | null> {
    return consumeRate(this.rates, await this.resolved(spaceId), hits, (error) =>
      this.manablox.logger.warn({ err: error }, 'rate limit store unavailable, request allowed'),
    );
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
    return acquireSlot(this.rates, await this.resolved(spaceId), rule, ttl, (error) =>
      this.manablox.logger.warn({ err: error, rule }, 'rate limit store unavailable, slot allowed'),
    );
  }

  /** Purges `tags` here, in the shared cache and in every other process. */
  async invalidate(tags: readonly string[]): Promise<void> {
    if (tags.length === 0) return;
    if (this.shared) {
      await this.shared.purge([...tags]).catch((error: unknown) => {
        this.manablox.logger.warn({ err: error, tags }, 'controls cache purge failed');
      });
    }
    this.forget(tags);
    this.bus?.publish(tags.join(' '));
  }

  /** Drops in-process entries under `tags`; `null` drops everything. */
  forget(tags: readonly string[] | null): void {
    if (tags === null) this.promotes?.forget();
    else {
      const rest = tags.filter((tag) => !PROMOTE_TAG.test(tag));
      if (rest.length < tags.length) this.promotes?.forget();
      if (rest.length === 0) return;
      tags = rest;
    }
    this.generation++;
    this.emptyState = null;
    this.loading.clear();
    if (tags === null) {
      this.resolvedCache.clear();
      this.groups.clear();
      return;
    }
    for (const [key, entry] of this.resolvedCache) if (entry.empty) this.resolvedCache.delete(key);
    for (const tag of tags) {
      if (tag === INSTANCE_TAG) {
        this.resolvedCache.clear();
        continue;
      }
      const group = /^controls:group:(.+)$/.exec(tag)?.[1];
      if (group) {
        for (const [key, entry] of this.resolvedCache) {
          if (entry.groupId === group) this.resolvedCache.delete(key);
        }
        continue;
      }
      const space = /^controls:space:(.+)$/.exec(tag)?.[1];
      if (space) {
        this.resolvedCache.delete(space);
        this.groups.delete(space);
      }
    }
  }

  private async load(
    key: string,
    spaceId: string | null,
    ceilings: FeatureCeilingValues,
  ): Promise<ResolvedControls> {
    const generation = this.generation;
    const keep = (stored: ScopeValues[], empty: boolean) => {
      const value = deepFreeze(resolveAll(stored, {}, ceilings));
      if (generation !== this.generation) return value;
      sweep(this.resolvedCache);
      this.resolvedCache.set(key, {
        value,
        groupId: groupOfScopes(stored.map((entry) => entry.scope)),
        empty,
        ceilings: ceilings.version,
        expires: Date.now() + this.ttl,
      });
      return value;
    };

    if (await this.isEmpty()) {
      // Without stored values the group changes nothing, so it is not looked up.
      return keep(scopeValues(scopeChain(spaceId), []), true);
    }

    // The stored values only: another process may have other ceilings.
    const sharedKey = `controls:stored:${key}`;
    const cached = await this.sharedGet<ScopeValues[]>(sharedKey);
    if (cached) return keep(cached, false);

    const groupId = spaceId === null ? null : await this.groupOf(spaceId);
    const scopes = scopeChain(spaceId, groupId);
    const stored = scopeValues(scopes, await this.repos.controlSettings.listByScopes(scopes));
    if (generation === this.generation) {
      await this.sharedSet(sharedKey, stored, scopes.map(controlScopeTag));
    }
    return keep(stored, false);
  }

  /** Whether no scope stores anything; checked at most once per TTL. */
  private async isEmpty(): Promise<boolean> {
    if (this.emptyState && this.emptyState.expires > Date.now()) return this.emptyState.value;
    const generation = this.generation;
    const empty = !(await this.repos.controlSettings.hasAny());
    if (generation === this.generation) {
      this.emptyState = { value: empty, expires: Date.now() + this.ttl };
    }
    return empty;
  }

  /** The group a space is in. */
  private async groupOf(spaceId: string): Promise<string | null> {
    const hit = this.groups.get(spaceId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const generation = this.generation;
    const sharedKey = `controls:groupOf:${spaceId}`;
    let groupId = (await this.sharedGet<{ groupId: string | null }>(sharedKey))?.groupId;
    if (groupId === undefined) {
      groupId = (await this.repos.spaceGroups.findBySpace(spaceId))?.id ?? null;
      if (generation === this.generation) {
        await this.sharedSet(sharedKey, { groupId }, [
          controlScopeTag({ kind: 'space', id: spaceId }),
        ]);
      }
    }
    if (generation === this.generation) {
      sweep(this.groups);
      this.groups.set(spaceId, { value: groupId, expires: Date.now() + this.ttl });
    }
    return groupId;
  }

  private async countTarget(
    scope: ControlScope,
    spaceId: string | null,
  ): Promise<LimitCountTarget> {
    if (scope.kind === 'instance') return { scope, spaceIds: 'all', spaceId };
    if (scope.kind === 'space') return { scope, spaceIds: [scope.id], spaceId };
    return { scope, spaceIds: await this.repos.spaceGroups.listSpaceIds(scope.id), spaceId };
  }

  private async sharedGet<T>(key: string): Promise<T | null> {
    if (!this.shared) return null;
    try {
      return await this.shared.get<T>(key);
    } catch (error) {
      this.manablox.logger.debug({ err: error, key }, 'controls cache read failed');
      return null;
    }
  }

  private async sharedSet(key: string, value: unknown, tags: string[]): Promise<void> {
    if (!this.shared) return;
    try {
      await this.shared.set(key, value, { ttl: Math.ceil(this.ttl / 1000), tags });
    } catch (error) {
      this.manablox.logger.debug({ err: error, key }, 'controls cache write failed');
    }
  }
}

/** The space's scope, or the instance's for `null`. */
function scopeOf(spaceId: string | null): ControlScope {
  return spaceId === null ? { kind: 'instance' } : { kind: 'space', id: spaceId };
}

/** The stored values of each scope, by key. */
function scopeValues(scopes: ControlScope[], rows: readonly ControlSettingRow[]): ScopeValues[] {
  return scopes.map((scope) => {
    const id = scope.kind === 'instance' ? '' : scope.id;
    const values: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.scopeKind === scope.kind && row.scopeId === id) values[row.key] = row.value;
    }
    return { scope, values };
  });
}

function groupOfScopes(scopes: readonly ControlScope[]): string | null {
  const group = scopes.find((scope) => scope.kind === 'group');
  return group?.kind === 'group' ? group.id : null;
}

function sweep(entries: Map<string, { expires: number }>): void {
  if (entries.size < SWEEP_AT) return;
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expires <= now) entries.delete(key);
}

/** Shared by every caller, so nobody can change another's copy. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
