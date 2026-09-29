import { localCache } from '@manablox/cache';
import {
  API_HOSTS_CACHE_TAG,
  isSpaceReady,
  ManabloxError,
  type ResolvedScope,
  type SpaceScope,
} from '@manablox/core';
import { normaliseHostname } from '@manablox/services';
import type { Context, MiddlewareHandler } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse } from '../errors.js';
import type { SurfaceMode } from './mode.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** The space a public request is served from: pinned, or resolved from `Host`. */
    publicSpaceId?: string;
    /** Its environment: the API host's, else production. */
    publicScope?: ResolvedScope;
  }
}

/** How long a host's resolution is kept in process, and how many. */
const HOST_TTL_MS = 5_000;
const HOSTS_KEPT = 1_000;

/** Minimum gap between two picks of the only space. */
const PICK_RETRY_MS = 10_000;

/** The public request's space; `null` outside the public API. */
export const publicSpaceOf = (c: Context): string | null => c.get('publicSpaceId') ?? null;

/** The public request's space and environment; `null` outside the public API. */
export const publicScopeOf = (c: Context): ResolvedScope | null => c.get('publicScope') ?? null;

type Resolution =
  | { kind: 'space'; spaceId: string; environmentId?: string }
  | { kind: 'unknown' }
  | { kind: 'unresolved'; spaces: number };

/**
 * Sets `publicSpaceId` on every public request. A pinned instance serves its pin. Otherwise,
 * `/healthz` aside, an API host names the space; while the instance has no API host at all,
 * the only ready space is picked once and kept (503 `publicApi.space.unresolved` until one
 * exists); once any API host exists, other hosts answer 404 `publicApi.host.unknown`, but
 * `/readyz`.
 */
export function publicHostResolution(
  runtime: Runtime,
  mode: SurfaceMode,
  retryMs = PICK_RETRY_MS,
): MiddlewareHandler {
  const { manablox, cache, apiHosts } = runtime;
  const ttl = manablox.config.cache.ttl;
  // In process for seconds, then the shared cache; an API host change purges both everywhere.
  const kept = localCache<unknown>(manablox, { max: HOSTS_KEPT, ttlMs: HOST_TTL_MS });
  const shared = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = await cache.get<{ value: T }>(key);
    if (hit) return hit.value;
    const value = await load();
    await cache.set(key, { value }, { ttl, tags: [API_HOSTS_CACHE_TAG] });
    return value;
  };
  const cached = <T>(key: string, load: () => Promise<T>): Promise<T> =>
    kept.load(key, async () => ({
      value: await shared(key, load),
      tags: [API_HOSTS_CACHE_TAG],
    })) as Promise<T>;

  let picked: string | null = null;
  let spaces = 0;
  let lastPick = 0;
  let picking: Promise<void> | null = null;
  const pick = async (): Promise<void> => {
    // A space still importing does not count.
    const ready = (await runtime.repos.spaces.list()).filter(isSpaceReady);
    spaces = ready.length;
    const only = ready[0];
    if (ready.length !== 1 || !only) return;
    picked = only.id;
    manablox.logger.info(
      { spaceId: only.id, machineName: only.machineName },
      'public api serves the only space; set publicApi.spaceId or add API hosts to be explicit',
    );
  };

  const resolve = async (host: string): Promise<Resolution> => {
    const hostname = host.length > 300 ? null : normaliseHostname(host);
    const found: SpaceScope | null = hostname
      ? await cached(`api:host:${hostname}`, () => apiHosts.resolve(hostname))
      : null;
    if (found) return { kind: 'space', ...found };
    if (await cached('api:hosts:any', () => apiHosts.any())) return { kind: 'unknown' };
    if (!picked && !picking && Date.now() - lastPick >= retryMs) {
      lastPick = Date.now();
      picking = pick().finally(() => {
        picking = null;
      });
    }
    if (picking) await picking;
    return picked ? { kind: 'space', spaceId: picked } : { kind: 'unresolved', spaces };
  };

  /** The resolved scope; a staging host needs `environments`, else it is unknown. */
  const scopeOf = async (
    spaceId: string,
    environmentId?: string,
  ): Promise<ResolvedScope | null> => {
    const scope = environmentId
      ? await runtime.environments.resolve({ spaceId, environmentId })
      : await runtime.environments.scope(spaceId);
    if (scope.production) return scope;
    const feature = await manablox.controls.feature(spaceId, 'environments');
    return feature.enabled ? scope : null;
  };
  const unknownHost = (c: Context) =>
    errorResponse(c, ManabloxError.notFound('publicApi.host.unknown'));

  let warned = false;
  return async (c, next) => {
    if (mode.pinnedSpaceId) {
      c.set('publicSpaceId', mode.pinnedSpaceId);
      const pinned = await scopeOf(mode.pinnedSpaceId).catch(() => null);
      if (pinned) c.set('publicScope', pinned);
      return next();
    }
    if (c.req.path === '/healthz') return next();
    const found = await resolve(c.req.header('host') ?? new URL(c.req.url).host);
    if (found.kind === 'space') {
      const scope = await scopeOf(found.spaceId, found.environmentId).catch(() => null);
      if (!scope) return c.req.path === '/readyz' ? next() : unknownHost(c);
      c.set('publicSpaceId', found.spaceId);
      c.set('publicScope', scope);
      return next();
    }
    if (found.kind === 'unknown') {
      // Readiness does not depend on the host the probe used.
      if (c.req.path === '/readyz') return next();
      return unknownHost(c);
    }
    if (!warned) {
      warned = true;
      manablox.logger.warn(
        { spaces: found.spaces },
        'public api has no space to serve and answers 503; add API hosts, or pin one with publicApi.spaceId or spaceMachineName (MANABLOX_SPACE_ID / MANABLOX_SPACE)',
      );
    }
    return errorResponse(
      c,
      ManabloxError.unavailable('publicApi.space.unresolved', { spaces: found.spaces }),
    );
  };
}
