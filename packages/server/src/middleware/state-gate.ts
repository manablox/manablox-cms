import { ManabloxError, suspendedRefused } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { MiddlewareHandler } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse } from '../errors.js';
import type { SurfaceMode } from '../surfaces/mode.js';
import { markNotMetered } from './served.js';

/** Whether the space (the instance with `null`) takes writes. */
export async function writable(manablox: Manablox, spaceId: string | null): Promise<boolean> {
  return (await manablox.controls.resolved(spaceId)).state.status === 'active';
}

/** Management paths that serve content, and those that write, outside the RPC surface. */
const SERVED = /^\/(v1|media|api\/hooks)\//;
const WRITES = /^\/(upload|transfer|realtime|plugins)\//;

/**
 * While the instance is suspended: content (delivery, GraphQL, media, plugin modes, incoming
 * hooks) answers 503, and upload, transfer, realtime and plugin routes refuse with 423
 * `control.suspended`. RPC refuses in its base procedure; auth, control and the admin's
 * files stay up.
 */
export function stateGate(runtime: Runtime, mode: SurfaceMode): MiddlewareHandler {
  const { manablox } = runtime;
  const graphql = manablox.config.graphql.path;
  const gateOf = (path: string): 'served' | 'refused' | null => {
    if (mode.plugin) return mode.plugin.unsuspended?.(path) ? null : 'served';
    if (mode.isPublic || path === graphql || SERVED.test(path)) return 'served';
    return WRITES.test(path) ? 'refused' : null;
  };

  return async (c, next) => {
    const gate = gateOf(c.req.path);
    if (!gate) return next();
    const { state } = await manablox.controls.resolved(null);
    if (state.status !== 'suspended') return next();
    markNotMetered(c);
    if (gate === 'refused') return errorResponse(c, suspendedRefused(state.message ?? null));
    const response = mode.plugin?.fallback
      ? mode.plugin.fallback(c, 503)
      : errorResponse(c, ManabloxError.unavailable('service.unavailable'));
    response.headers.set('cache-control', 'no-store');
    return response;
  };
}
