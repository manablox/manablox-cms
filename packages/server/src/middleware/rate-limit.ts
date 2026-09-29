import { createHash } from 'node:crypto';
import {
  type Controls,
  type RateDecision,
  type RateHit,
  type RateLimitRuleName,
  type RateRule,
  rateLimitExceeded,
} from '@manablox/core';
import type { Context, MiddlewareHandler } from 'hono';
import { errorResponse } from '../errors.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** The rule `principal()` counts once the caller is known. */
    rateLimitDeferred?: { rule: RateLimitRuleName; fallback: RateRule | null | undefined };
  }
}

/** The hits a request counts, and the space whose controls set their limits. */
export interface RateLimitRequest {
  spaceId: string | null;
  hits: RateHit[];
}

/** The IETF `RateLimit-*` fields, plus `Retry-After` on a refusal. */
export function rateLimitHeaders(decision: RateDecision): Record<string, string> {
  return {
    'ratelimit-limit': String(decision.limit),
    'ratelimit-remaining': String(decision.remaining),
    'ratelimit-reset': String(decision.reset),
    ...(decision.allowed ? {} : { 'retry-after': String(decision.retryAfter) }),
  };
}

/** Sets the headers on a response, unless it is immutable. */
export function withRateLimitHeaders(response: Response, decision: RateDecision): Response {
  try {
    for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
      response.headers.set(name, value);
    }
  } catch {
    // A response passed through from `fetch` keeps its headers.
  }
  return response;
}

/**
 * Counts the request against the rules `rules` names, in one store call, and answers
 * `rateLimit.exceeded` (429) when one refuses. A failing store lets the request through.
 */
export function rateLimit(
  controls: () => Controls,
  rules: (c: Context) => RateLimitRequest | null | Promise<RateLimitRequest | null>,
): MiddlewareHandler {
  return async (c, next) => {
    const request = await rules(c);
    if (!request || request.hits.length === 0) return next();
    const decision = await controls().rate(request.spaceId, request.hits);
    if (decision && !decision.allowed) {
      return withRateLimitHeaders(
        errorResponse(c, rateLimitExceeded(decision.rule, decision.retryAfter)),
        decision,
      );
    }
    await next();
    // A narrower rule further in may have set its own.
    if (decision && !c.res.headers.has('ratelimit-limit')) withRateLimitHeaders(c.res, decision);
  };
}

/** A short digest of a credential, so buckets never hold it. */
export function credentialKey(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}
