/**
 * Pure scope resolution: stored values of instance, group and space in, effective value out.
 * Features also resolve over the plugins' ceilings, which sit above the instance.
 */

import { intersectMimeTypes } from '../mime.js';
import {
  type AnyRateRuleKey,
  type AnyUsageMetric,
  CONTROL_CATALOGUE_VERSION,
  type ControlEntry,
  type ControlKey,
  type ControlValue,
  type ControlValues,
  catalogueEntries,
  controlEntry,
  type FeatureKey,
  type LimitKey,
  type PluginControlSuffix,
  type RateRuleKey,
  type RetentionKey,
  type UsageMetric,
} from './catalogue.js';
import { type FeatureCeilingValues, NO_CEILINGS } from './ceilings.js';
import type {
  AdminBanner,
  AdminLinks,
  ControlScope,
  FeatureControl,
  FeatureScope,
  LimitControl,
  RateRule,
  ResolvedFeature,
  ResolvedLimit,
  ResolvedState,
  ResolvedUploadRules,
  SnapshotInterval,
  StateControl,
  UsageLevel,
} from './types.js';

/** The value one scope stores; `undefined` is unset. */
export interface ScopedValue<T, S extends FeatureScope = ControlScope> {
  scope: S;
  value: T | undefined;
}

/** Instance first, then the space's group, then the space; a feature's ceiling before all. */
export type ScopeChain<T, S extends FeatureScope = ControlScope> = readonly ScopedValue<T, S>[];

/** The scopes that apply to a space, most general first; `null` is the instance alone. */
export function scopeChain(spaceId: string | null, groupId: string | null = null): ControlScope[] {
  const chain: ControlScope[] = [{ kind: 'instance' }];
  if (spaceId !== null && groupId !== null) chain.push({ kind: 'group', id: groupId });
  if (spaceId !== null) chain.push({ kind: 'space', id: spaceId });
  return chain;
}

/** `instance`, `group:<id>` or `space:<id>`. */
export function scopeLabel(scope: ControlScope): string {
  return scope.kind === 'instance' ? 'instance' : `${scope.kind}:${scope.id}`;
}

export function parseScopeLabel(label: string): ControlScope | null {
  if (label === 'instance') return { kind: 'instance' };
  const match = /^(group|space):(.+)$/.exec(label);
  if (!match?.[2]) return null;
  return { kind: match[1] as 'group' | 'space', id: match[2] };
}

const DEFAULT_THRESHOLDS = [80, 100];

/** The set values, with the catalogue default standing in for an unset instance. */
function withDefault<T>(chain: ScopeChain<T>, fallback: T): ScopedValue<T>[] {
  return chain.flatMap((entry) => {
    if (entry.value !== undefined) return [entry as ScopedValue<T>];
    return entry.scope.kind === 'instance' ? [{ scope: entry.scope, value: fallback }] : [];
  });
}

/**
 * On only if no scope sets it off; an unset group or space counts as on. The most specific
 * presentation wins; message and link come from the most specific scope that switches it off.
 * A ceiling that is off always wins; as the only scope off, it gives message, link and
 * presentation.
 */
export function resolveFeature(
  chain: ScopeChain<FeatureControl, FeatureScope>,
  fallback: FeatureControl,
): ResolvedFeature {
  const { ceiling, stored } = splitCeiling(chain);
  const set = withDefault(stored, fallback).map((entry) => entry.value as FeatureControl);
  const result = featureResult(
    set.every((value) => value.enabled),
    set,
  );
  if (!ceiling) return result;
  if (result.enabled) return ceilingResult(ceiling);
  // A stored scope has it off too: its words are the more specific, the ceiling's fill in.
  const message = result.message ?? ceiling.message;
  const link = result.link ?? ceiling.link;
  return {
    ...result,
    ...(message !== undefined ? { message } : {}),
    ...(link !== undefined ? { link } : {}),
  };
}

/**
 * The most specific set flag decides, for flags whose off state is the unrestricted one. A
 * ceiling that is off decides instead, with its message, link and presentation.
 */
export function resolveFeatureMostSpecific(
  chain: ScopeChain<FeatureControl, FeatureScope>,
  fallback: FeatureControl,
): ResolvedFeature {
  const { ceiling, stored } = splitCeiling(chain);
  if (ceiling) return ceilingResult(ceiling);
  const set = withDefault(stored, fallback).map((entry) => entry.value as FeatureControl);
  return featureResult(set.at(-1)?.enabled ?? fallback.enabled, set);
}

/** The chain's ceiling if it is off, and the stored scopes; no stored scope lifts a ceiling. */
function splitCeiling(chain: ScopeChain<FeatureControl, FeatureScope>): {
  ceiling: FeatureControl | undefined;
  stored: ScopedValue<FeatureControl>[];
} {
  let ceiling: FeatureControl | undefined;
  const stored: ScopedValue<FeatureControl>[] = [];
  for (const entry of chain) {
    if (entry.scope.kind !== 'ceiling') stored.push(entry as ScopedValue<FeatureControl>);
    else if (entry.value && !entry.value.enabled) ceiling ??= entry.value;
  }
  return { ceiling, stored };
}

function ceilingResult(ceiling: FeatureControl): ResolvedFeature {
  return {
    enabled: false,
    presentation: ceiling.presentation ?? 'locked',
    ...(ceiling.message !== undefined ? { message: ceiling.message } : {}),
    ...(ceiling.link !== undefined ? { link: ceiling.link } : {}),
  };
}

function featureResult(enabled: boolean, set: FeatureControl[]): ResolvedFeature {
  const specificFirst = [...set].reverse();
  const deciding = enabled ? specificFirst : specificFirst.filter((value) => !value.enabled);
  const message = deciding.find((value) => value.message !== undefined)?.message;
  const link = deciding.find((value) => value.link !== undefined)?.link;
  return {
    enabled,
    presentation: specificFirst.find((value) => value.presentation)?.presentation ?? 'locked',
    ...(message !== undefined ? { message } : {}),
    ...(link !== undefined ? { link } : {}),
  };
}

/** Every scope that sets a limit, each checked on its own; unlimited and `off` drop out. */
export function resolveLimits(
  chain: ScopeChain<LimitControl>,
  fallback: LimitControl,
): ResolvedLimit[] {
  return withDefault(chain, fallback).flatMap(({ scope, value }) => {
    const control = value as LimitControl;
    if (control.max === null || control.mode === 'off') return [];
    return [
      {
        scope,
        max: control.max,
        mode: control.mode,
        thresholds: control.thresholds ?? DEFAULT_THRESHOLDS,
      },
    ];
  });
}

/** The most specific set value, else the default. */
export function resolveMostSpecific<T>(chain: ScopeChain<T>, fallback: T): T {
  for (let index = chain.length - 1; index >= 0; index--) {
    const value = chain[index]?.value;
    if (value !== undefined) return value;
  }
  return fallback;
}

/** The smallest set maximum; `null` when none is set. */
export function resolveStrictestMax(
  chain: ScopeChain<number | null>,
  fallback: number | null,
): number | null {
  const values = withDefault(chain, fallback)
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === 'number');
  return values.length > 0 ? Math.min(...values) : null;
}

/** The types every set list admits; `null` when none is set, `[]` when nothing is left. */
export function resolveMimeIntersection(
  chain: ScopeChain<string[] | null>,
  fallback: string[] | null,
): string[] | null {
  return withDefault(chain, fallback)
    .map((entry) => entry.value)
    .filter((value): value is string[] => Array.isArray(value))
    .reduce<string[] | null>((result, allowed) => intersectMimeTypes(result, allowed), null);
}

/** Every scope's entries, instance first. */
export function resolveConcat<T>(chain: ScopeChain<T[]>, fallback: T[]): T[] {
  return withDefault(chain, fallback).flatMap((entry) => entry.value ?? []);
}

const SEVERITY = { active: 0, readOnly: 1, suspended: 2 } as const;

/** The most severe status; on a tie the most specific scope. */
export function resolveState(
  chain: ScopeChain<StateControl>,
  fallback: StateControl,
): ResolvedState {
  let result: ResolvedState = { status: fallback.status, scope: null };
  for (const { scope, value } of chain) {
    if (value === undefined || value.status === 'active') continue;
    if (SEVERITY[value.status] < SEVERITY[result.status]) continue;
    result = {
      status: value.status,
      scope,
      ...(value.message !== undefined ? { message: value.message } : {}),
    };
  }
  return result;
}

/** One key resolved by its catalogue rule. */
export function resolveControl<K extends ControlKey>(
  key: K,
  chain: ScopeChain<ControlValue<K>, FeatureScope>,
): ResolvedControlValue<K> {
  const found = controlEntry(key);
  if (!found) throw new Error(`Unknown control key: ${key}`);
  return resolveEntry(found, chain as ScopeChain<unknown, FeatureScope>) as ResolvedControlValue<K>;
}

/** The resolved form of each key's value. */
export type ResolvedControlValue<K extends ControlKey> =
  ControlValue<K> extends FeatureControl
    ? ResolvedFeature
    : ControlValue<K> extends LimitControl
      ? ResolvedLimit[]
      : ControlValue<K> extends StateControl
        ? ResolvedState
        : ControlValue<K>;

/** Only a feature's chain holds a ceiling. */
function resolveEntry(
  found: ControlEntry,
  featureChain: ScopeChain<unknown, FeatureScope>,
): unknown {
  const fallback = found.default;
  const chain = featureChain as ScopeChain<unknown>;
  switch (found.resolution) {
    case 'feature':
      return resolveFeature(
        featureChain as ScopeChain<FeatureControl, FeatureScope>,
        fallback as FeatureControl,
      );
    case 'perScope':
      return resolveLimits(chain as ScopeChain<LimitControl>, fallback as LimitControl);
    case 'strictestMax':
      return resolveStrictestMax(chain as ScopeChain<number | null>, fallback as number | null);
    case 'mimeIntersection':
      return resolveMimeIntersection(
        chain as ScopeChain<string[] | null>,
        fallback as string[] | null,
      );
    case 'concat':
      return resolveConcat(chain as ScopeChain<unknown[]>, fallback as unknown[]);
    case 'severest':
      return resolveState(chain as ScopeChain<StateControl>, fallback as StateControl);
    case 'mostSpecific':
      return found.kind === 'feature'
        ? resolveFeatureMostSpecific(
            featureChain as ScopeChain<FeatureControl, FeatureScope>,
            fallback as FeatureControl,
          )
        : resolveMostSpecific(chain, fallback);
  }
}

/** The stored rows of one scope, by key. */
export interface ScopeValues {
  scope: ControlScope;
  values: Partial<Record<string, unknown>>;
}

/** Usage state per metric, filled by the control service. */
export interface UsageStatus {
  level: UsageLevel;
  used: number;
  /** The start of the next period, ISO 8601. */
  resetsAt: string;
}

/** Every control for one space (or the instance alone), as plain JSON. */
export interface ResolvedControls {
  version: string;
  scopes: ControlScope[];
  state: ResolvedState;
  features: Record<Exclude<FeatureKey, `plugins.${string}`>, ResolvedFeature> &
    Partial<Record<`plugins.${string}`, ResolvedFeature>>;
  /** Plugin keys (`plugins.<id>.<name>`) are present while the plugin is loaded. */
  limits: Record<LimitKey, ResolvedLimit[]> & Partial<Record<PluginControlSuffix, ResolvedLimit[]>>;
  usage: {
    periodAnchorDay: number;
    limits: Record<UsageMetric, ResolvedLimit[]> &
      Partial<Record<PluginControlSuffix, ResolvedLimit[]>>;
    status: Partial<Record<AnyUsageMetric, UsageStatus>>;
  };
  rateLimits: { [K in RateRuleKey]: ControlValues[`rateLimits.${K}`] } & Partial<
    Record<PluginControlSuffix, RateRule | null>
  >;
  /** The most specific scope that sets each rule; a rule no scope sets is absent. */
  rateLimitScopes: Partial<Record<AnyRateRuleKey, ControlScope>>;
  retention: { [K in RetentionKey]: ControlValues[`retention.${K}`] } & Partial<
    Record<PluginControlSuffix, number | null>
  >;
  uploads: ResolvedUploadRules;
  messages: { banners: AdminBanner[]; links: AdminLinks };
  settings: {
    snapshotsInterval: SnapshotInterval | null;
    domainsRequireVerification: boolean;
    authRequireEmailVerification: boolean;
    apiKeysDisable: boolean;
    /** Plugin settings by `<id>.<name>`. */
    plugins: Record<string, unknown>;
  };
}

/**
 * Resolves every key from the stored rows of the scopes that apply, most general first, and
 * the features under `ceilings`. Values are trusted as validated on write; plugin flags appear
 * once any scope or ceiling sets them. Ceiling banners come before the stored ones.
 */
export function resolveAll(
  scopes: readonly ScopeValues[],
  usageStatus: Partial<Record<AnyUsageMetric, UsageStatus>> = {},
  ceilings: FeatureCeilingValues = NO_CEILINGS,
): ResolvedControls {
  const chainOf = (key: string): ScopeChain<unknown, FeatureScope> => {
    const stored = scopes.map(({ scope, values }) => ({ scope, value: values[key] }));
    const ceiling = key.startsWith('features.')
      ? ceilings.features.get(key.slice('features.'.length) as FeatureKey)
      : undefined;
    return ceiling ? [{ scope: { kind: 'ceiling' }, value: ceiling }, ...stored] : stored;
  };
  const resolved = new Map<string, unknown>();
  for (const [key, found] of catalogueEntries())
    resolved.set(key, resolveEntry(found, chainOf(key)));
  const pluginKeys = new Set(
    [
      ...scopes.flatMap(({ values }) => Object.keys(values)),
      ...[...ceilings.features.keys()].map((key) => `features.${key}`),
    ].filter((key) => key.startsWith('features.plugins.')),
  );
  for (const key of pluginKeys) {
    const found = controlEntry(key);
    if (found) resolved.set(key, resolveEntry(found, chainOf(key)));
  }

  const section = (prefix: string) =>
    Object.fromEntries(
      [...resolved]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    ) as never;
  const get = <K extends ControlKey>(key: K) => resolved.get(key) as ResolvedControlValue<K>;

  return {
    version: CONTROL_CATALOGUE_VERSION,
    scopes: scopes.map((entry) => entry.scope),
    state: get('state'),
    features: section('features.'),
    limits: section('limits.'),
    usage: {
      periodAnchorDay: get('usagePeriodAnchorDay'),
      limits: section('usage.'),
      status: usageStatus,
    },
    rateLimits: section('rateLimits.'),
    rateLimitScopes: rateLimitScopes(scopes),
    retention: section('retention.'),
    uploads: {
      maxFileSize: get('uploads.maxFileSize'),
      allowedMimeTypes: get('uploads.allowedMimeTypes'),
    },
    messages: {
      banners: [...ceilings.banners, ...get('admin.banners')],
      links: get('admin.links'),
    },
    settings: {
      snapshotsInterval: get('snapshots.interval'),
      domainsRequireVerification: get('domains.requireVerification'),
      authRequireEmailVerification: get('auth.requireEmailVerification'),
      apiKeysDisable: get('apiKeysDisable'),
      plugins: section('plugins.'),
    },
  };
}

/** The most specific scope that stores each rate rule. */
function rateLimitScopes(
  scopes: readonly ScopeValues[],
): Partial<Record<AnyRateRuleKey, ControlScope>> {
  const out: Partial<Record<AnyRateRuleKey, ControlScope>> = {};
  for (const { scope, values } of scopes) {
    for (const [key, value] of Object.entries(values)) {
      if (key.startsWith('rateLimits.') && value !== undefined) {
        out[key.slice('rateLimits.'.length) as AnyRateRuleKey] = scope;
      }
    }
  }
  return out;
}

/** A limit a count would break, with the count at its scope. */
export interface LimitBreach {
  limit: ResolvedLimit;
  used: number;
}

/**
 * Checks `used + increment` against every limit. `hard` is the first hard limit passed (the
 * action is refused); `soft` lists soft limits passed (the action goes ahead). A scope the
 * action adds nothing to passes, even when already over.
 */
export function checkLimits(
  limits: readonly ResolvedLimit[],
  usedAt: (scope: ControlScope) => number,
  increment: number | ((scope: ControlScope) => number) = 1,
): { hard: LimitBreach | null; soft: LimitBreach[] } {
  let hard: LimitBreach | null = null;
  const soft: LimitBreach[] = [];
  for (const limit of limits) {
    const added = typeof increment === 'number' ? increment : increment(limit.scope);
    if (added <= 0) continue;
    const used = usedAt(limit.scope);
    if (used + added <= limit.max) continue;
    if (limit.mode === 'hard') hard ??= { limit, used };
    else soft.push({ limit, used });
  }
  return { hard, soft };
}

const LEVEL_ORDER: UsageLevel[] = ['ok', 'warn', 'over', 'blocked'];

/** `blocked` (hard, used up), `over` (soft, beyond max), `warn` (threshold crossed) or `ok`. */
export function usageLevel(
  limits: readonly ResolvedLimit[],
  usedAt: (scope: ControlScope) => number,
): UsageLevel {
  let level: UsageLevel = 'ok';
  const raise = (next: UsageLevel) => {
    if (LEVEL_ORDER.indexOf(next) > LEVEL_ORDER.indexOf(level)) level = next;
  };
  for (const limit of limits) {
    const used = usedAt(limit.scope);
    if (limit.mode === 'hard' && used >= limit.max) raise('blocked');
    else if (used > limit.max) raise('over');
    else if (limit.thresholds.some((percent) => used * 100 >= limit.max * percent)) raise('warn');
  }
  return level;
}
