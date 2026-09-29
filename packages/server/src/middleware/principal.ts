import { assertSuperadmin, auditActorFor, type Principal, resolvePrincipal } from '@manablox/auth';
import {
  type AuditActor,
  CLIENT_ID_HEADER,
  type Controls,
  rateLimitExceeded,
} from '@manablox/core';
import { runAsActor, runAsClient } from '@manablox/core/node';
import type { Context, MiddlewareHandler } from 'hono';
import type { Runtime } from '../bootstrap.js';
import { errorResponse } from '../errors.js';
import { clientIp } from './client-ip.js';
import { withRateLimitHeaders } from './rate-limit.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** Set by `principal()`; `null` when anonymous. */
    principal?: Principal | null;
    /** Set by `principal()`; who the request's writes are audited as. */
    auditActor?: AuditActor;
  }
}

export type PrincipalRuntime = Pick<Runtime, 'auth' | 'repos' | 'apiKeys'> & {
  /** Counts the rule the global limiter left to the resolved caller. */
  manablox?: { controls: Controls };
  /** Strips the grants of a session that must enrol in two-factor first. */
  twoFactor?: Pick<Runtime['twoFactor'], 'pending'>;
};

export interface PrincipalOptions {
  /** Resolves only when this holds; otherwise the request stays anonymous and unwrapped. */
  when?: (c: Context) => boolean;
}

/** The caller behind the request headers: an API key or a session. */
export function resolveRequestPrincipal(
  runtime: PrincipalRuntime,
  headers: Headers,
): Promise<Principal | null> {
  return resolvePrincipal(runtime.auth, runtime.repos, headers, runtime.apiKeys, runtime.twoFactor);
}

/** Sets `principal` and `auditActor`, and runs the rest as that actor and client. */
export function principal(
  runtime: PrincipalRuntime,
  options: PrincipalOptions = {},
): MiddlewareHandler {
  return async (c, next) => {
    if (options.when && !options.when(c)) {
      c.set('principal', null);
      return deferredRateLimit(runtime, c, null, next);
    }
    const resolved = await resolveRequestPrincipal(runtime, c.req.raw.headers);
    const actor = auditActorFor(resolved, {
      headers: c.req.raw.headers,
      requestId: c.get('requestId'),
    });
    c.set('principal', resolved);
    c.set('auditActor', actor);
    return deferredRateLimit(runtime, c, resolved, () =>
      runAsClient(c.req.header(CLIENT_ID_HEADER), () => runAsActor(actor, next)),
    );
  };
}

/** The rule the global limiter deferred, counted per user, else per IP. */
async function deferredRateLimit(
  runtime: PrincipalRuntime,
  c: Context,
  resolved: Principal | null,
  next: () => Promise<void>,
): Promise<Response | undefined> {
  const deferred = c.get('rateLimitDeferred');
  if (!deferred || !runtime.manablox) {
    await next();
    return undefined;
  }
  c.set('rateLimitDeferred', undefined);
  const key = resolved && !resolved.viaApiKey ? `user:${resolved.userId}` : `ip:${clientIp(c)}`;
  const decision = await runtime.manablox.controls.rate(null, [
    { rule: deferred.rule, key, fallback: deferred.fallback },
  ]);
  if (decision && !decision.allowed) {
    return withRateLimitHeaders(
      errorResponse(c, rateLimitExceeded(decision.rule, decision.retryAfter)),
      decision,
    );
  }
  await next();
  if (decision && !c.res.headers.has('ratelimit-limit')) withRateLimitHeaders(c.res, decision);
  return undefined;
}

/** The principal `principal()` resolved; `null` when anonymous. */
export function principalOf(c: Context): Principal | null {
  return c.get('principal') ?? null;
}

/** Requires an instance-wide superadmin; mount after `principal()`. */
export const requireSuperadmin: MiddlewareHandler = async (c, next) => {
  assertSuperadmin(principalOf(c));
  await next();
};
