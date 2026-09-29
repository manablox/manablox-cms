import {
  type AnyUsageMetric,
  type ControlScope,
  controlEntry,
  type LimitControl,
  parseScopeLabel,
  type ResolvedLimit,
  resolveLimits,
  scopeLabel,
  usageControlKey,
  usageMetrics,
} from '@manablox/core';
import type { Repositories, SpaceRow } from '@manablox/db';

/** Usage of one period with the usage limits stored per scope, read in a few queries. */
export interface UsageSnapshot {
  period: string;
  spaces: SpaceRow[];
  /** Scopes that store at least one usage limit, instance first. */
  limitedScopes: ControlScope[];
  /** The usage limit stored at a scope (the catalogue default at the instance). */
  limitAt(scope: ControlScope, metric: AnyUsageMetric): ResolvedLimit | null;
  /** Counted plus external usage of the scope's spaces. */
  usedAt(scope: ControlScope, metric: AnyUsageMetric): number;
}

/** Reads the limits; usage only when `withUsage` or some scope limits usage. */
export async function loadUsageSnapshot(
  repos: Repositories,
  period: string,
  options: { withUsage?: boolean } = {},
): Promise<UsageSnapshot> {
  const metrics = usageMetrics();
  const stored = new Map<string, Map<AnyUsageMetric, LimitControl>>();
  for (const row of await repos.controlSettings.listAll()) {
    if (!row.key.startsWith('usage.')) continue;
    const metric = row.key.slice('usage.'.length) as AnyUsageMetric;
    if (!metrics.includes(metric)) continue;
    const label = row.scopeKind === 'instance' ? 'instance' : `${row.scopeKind}:${row.scopeId}`;
    const values = stored.get(label) ?? new Map<AnyUsageMetric, LimitControl>();
    values.set(metric, row.value as LimitControl);
    stored.set(label, values);
  }
  const limits = new Map<string, ResolvedLimit | null>();
  const limitAt = (scope: ControlScope, metric: AnyUsageMetric): ResolvedLimit | null => {
    const key = `${scopeLabel(scope)} ${metric}`;
    if (limits.has(key)) return limits.get(key) ?? null;
    const fallback = (controlEntry(usageControlKey(metric))?.default as LimitControl) ?? {
      max: null,
      mode: 'off',
    };
    const value = stored.get(scopeLabel(scope))?.get(metric);
    const [limit] = resolveLimits([{ scope, value }], fallback);
    limits.set(key, limit ?? null);
    return limit ?? null;
  };
  const limitedScopes = [
    { kind: 'instance' } as ControlScope,
    ...[...stored.keys()].flatMap((label) => {
      const scope = parseScopeLabel(label);
      return scope && scope.kind !== 'instance' ? [scope] : [];
    }),
  ].filter((scope) => metrics.some((metric) => limitAt(scope, metric) !== null));

  const needed = options.withUsage || limitedScopes.length > 0;
  const [counted, external, spaces] = needed
    ? await Promise.all([
        repos.usageCounters.listSpaces(period, metrics),
        repos.usageExternal.totals({ period }),
        repos.spaces.list(),
      ])
    : [[], [], []];
  const bySpace = new Map<string, Map<string, number>>();
  for (const entry of [...counted, ...external]) {
    const values = bySpace.get(entry.spaceId) ?? new Map<string, number>();
    values.set(entry.metric, (values.get(entry.metric) ?? 0) + entry.value);
    bySpace.set(entry.spaceId, values);
  }
  const groupOf = new Map(spaces.map((space) => [space.id, space.groupId ?? null]));
  const usedAt = (scope: ControlScope, metric: AnyUsageMetric): number => {
    let sum = 0;
    for (const [spaceId, values] of bySpace) {
      const inScope =
        scope.kind === 'instance' ||
        (scope.kind === 'space' ? spaceId === scope.id : groupOf.get(spaceId) === scope.id);
      if (inScope) sum += values.get(metric) ?? 0;
    }
    return sum;
  };
  return { period, spaces, limitedScopes, limitAt, usedAt };
}
