import { ENVIRONMENT_HEADER, PRODUCTION_ENVIRONMENT } from '@manablox/core';
import { shallowRef } from 'vue';
import type { LocationQuery, RouteLocationNormalized, RouteLocationRaw } from 'vue-router';

/** The query parameter naming the environment; absent means production. */
export const ENV_QUERY = 'env';

/** A staging environment the admin works in, bound to the space it was picked in. */
export interface ActiveEnvironment {
  spaceId: string | null;
  machineName: string;
  /** Known once the space's environments are loaded. */
  id: string | null;
}

/** `null` is production. */
export const activeEnvironment = shallowRef<ActiveEnvironment | null>(null);

/** The environment requests and query keys of `spaceId` use. */
export function environmentOf(spaceId: string | null | undefined): string {
  const active = activeEnvironment.value;
  return active && spaceId && active.spaceId === spaceId
    ? active.machineName
    : PRODUCTION_ENVIRONMENT;
}

/** Works in `machineName` of `spaceId` from now on; production for `null`. */
export function setEnvironment(
  spaceId: string | null,
  machineName: string | null,
  id: string | null = null,
): void {
  const active = activeEnvironment.value;
  if (!machineName || machineName === PRODUCTION_ENVIRONMENT) {
    if (active) activeEnvironment.value = null;
    return;
  }
  if (active?.spaceId === spaceId && active.machineName === machineName && active.id === id) return;
  activeEnvironment.value = { spaceId, machineName, id };
}

/** The `?env=` of a query, if it names one. */
export function queryEnvironment(query: LocationQuery): string | null {
  const value = query[ENV_QUERY];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Router step: adopts the target's `?env=`, or puts the active environment back on a
 * navigation that dropped it. `true`, or the location to go to instead.
 */
export function syncEnvironment(
  to: RouteLocationNormalized,
  spaceId: string | null,
): true | RouteLocationRaw {
  const asked = queryEnvironment(to.query);
  if (asked) {
    const active = activeEnvironment.value;
    if (active?.machineName !== asked || active.spaceId !== spaceId) setEnvironment(spaceId, asked);
    return true;
  }
  const active = activeEnvironment.value;
  if (!active || to.meta.public) return true;
  return { path: to.path, query: { ...to.query, [ENV_QUERY]: active.machineName }, hash: to.hash };
}

/** The environment header of an RPC call, for the active environment's space only. */
export function environmentHeaders(input: unknown): Record<string, string> {
  const raw = input as { spaceId?: unknown; filter?: { spaceId?: unknown } } | null | undefined;
  const spaceId = raw?.spaceId ?? raw?.filter?.spaceId;
  const environment = environmentOf(typeof spaceId === 'string' ? spaceId : null);
  return environment === PRODUCTION_ENVIRONMENT ? {} : { [ENVIRONMENT_HEADER]: environment };
}
