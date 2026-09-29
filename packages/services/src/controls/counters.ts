import type { AnyLimitKey, LimitIncrement, LimitKey, LimitTarget } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import {
  type Repositories,
  TOTAL_METRICS,
  TOTAL_PERIOD,
  type TotalMetric,
  type UsageSpaces,
} from '@manablox/db';
import type { DataCounter } from '../data/provider.js';
import { dataProviders } from '../data/registry.js';
import type { ControlStore, LimitCounter } from './store.js';

/** Keys counted in the acting space alone, whichever scope sets them. */
const PER_SPACE: ReadonlySet<LimitKey> = new Set([
  'localesPerSpace',
  'menusPerSpace',
  'redirectsPerSpace',
  'customRolesPerSpace',
  'environmentsPerSpace',
]);

type Count = (spaceIds: UsageSpaces) => Promise<number>;

/**
 * Registers a counter for every count limit: core's with data providers' counts added, and
 * plugin limits from their providers alone. Returns an unregister.
 */
export function registerLimitCounters(
  store: ControlStore,
  repos: Repositories,
  manablox: Manablox,
): () => void {
  const counts = repos.limitCounts;
  const total = (metric: TotalMetric) => (spaceIds: UsageSpaces) =>
    repos.usageCounters.sumForSpaces(metric, TOTAL_PERIOD, spaceIds);
  const counters: Partial<Record<AnyLimitKey, Count>> = {
    spaces: async (spaceIds) => (spaceIds === 'all' ? counts.spaces() : spaceIds.length),
    seats: (spaceIds) => counts.seats(spaceIds),
    contentTypes: (spaceIds) => counts.contentTypes(spaceIds, ['content', 'block']),
    documents: total('documents'),
    databagTypes: (spaceIds) => counts.contentTypes(spaceIds, ['data']),
    databagEntries: total('databagEntries'),
    localesPerSpace: async ([spaceId]) =>
      spaceId ? ((await repos.spaces.findById(spaceId))?.locales.length ?? 0) : 0,
    menusPerSpace: (spaceIds) => counts.menus(spaceIds),
    apiKeys: () => counts.apiKeys(),
    customDomains: (spaceIds) => counts.apiHosts(spaceIds),
    redirectsPerSpace: (spaceIds) => counts.manualRedirects(spaceIds),
    customRolesPerSpace: (spaceIds) => counts.customRoles(spaceIds),
    // Staging only: production is always there.
    environmentsPerSpace: async ([spaceId]) =>
      spaceId
        ? (await repos.environments.listBySpace(spaceId)).filter((row) => row.kind === 'staging')
            .length
        : 0,
    storageBytes: total('storageBytes'),
  };
  for (const provider of dataProviders(manablox)) {
    for (const [key, own] of Object.entries(provider.counters ?? {}) as Array<
      [AnyLimitKey, DataCounter]
    >) {
      const core = counters[key];
      const count: Count = (spaceIds) => own({ manablox, repos }, spaceIds);
      counters[key] = core
        ? async (spaceIds) => (await core(spaceIds)) + (await count(spaceIds))
        : count;
    }
  }
  const offs = (Object.entries(counters) as Array<[AnyLimitKey, Count]>).map(([key, count]) => {
    const counter: LimitCounter = PER_SPACE.has(key as LimitKey)
      ? (target) => (target.spaceId ? count([target.spaceId]) : Promise.resolve(0))
      : (target) => count(target.spaceIds);
    return store.registerLimitCounter(key, counter);
  });
  return () => {
    for (const off of offs) off();
  };
}

/**
 * Seats that adding `userIds` to a space takes: each at the space (the caller passes only new
 * members), those without a membership in the group at a group, none at the instance.
 */
export function seatIncrement(repos: Repositories, userIds: readonly string[]): LimitIncrement {
  return async (target: LimitTarget) => {
    if (target.scope.kind === 'instance') return 0;
    if (target.scope.kind === 'space') return new Set(userIds).size;
    return repos.limitCounts.usersOutside(
      target.spaceIds === 'all' ? [] : target.spaceIds,
      userIds,
    );
  };
}

/** Sets every `total` counter to the count of its rows; returns how many changed. */
export async function reconcileTotals(repos: Repositories): Promise<number> {
  const truth = await repos.limitCounts.totals();
  const stored = await repos.limitCounts.storedTotals();
  let changed = 0;
  for (const [spaceId, values] of truth) {
    for (const metric of TOTAL_METRICS) {
      if ((stored.get(spaceId)?.[metric] ?? null) === values[metric]) continue;
      await repos.usageCounters.set(
        { scope: { kind: 'space', id: spaceId }, metric, period: TOTAL_PERIOD },
        values[metric],
      );
      changed++;
    }
  }
  return changed;
}
