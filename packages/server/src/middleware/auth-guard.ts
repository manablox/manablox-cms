import { type BackoffPolicy, memoryRateLimitStore, type RateLimitStore } from '@manablox/cache';
import { type AuditAction, ManabloxError } from '@manablox/core';
import type { MiddlewareHandler } from 'hono';
import { errorResponse } from '../errors.js';
import { clientIp } from './client-ip.js';

export { backoffFor } from '@manablox/cache';

/**
 * Brute-force guard for credential routes (`auth.signIn`): exponential backoff per address and
 * per account, cleared on success, with every refusal audited. Shared through the store.
 */

/** Auth paths that carry a credential. */
const GUARDED = [
  'sign-in',
  'sign-up',
  'forget-password',
  'request-password-reset',
  'reset-password',
  'change-password',
  'change-email',
  'two-factor/',
];

export interface AuthGuardOptions {
  /** Where failures are counted; in process by default. */
  store?: RateLimitStore | undefined;
  /** The rule in effect; `null` switches the guard off. Defaults to the fixed options below. */
  policy?: () => Promise<Pick<BackoffPolicy, 'attempts' | 'window'> | null>;
  /** Attempts before backoff, per address and per account. */
  attempts?: number;
  /** How long failures are remembered. */
  window?: number;
  /** Backoff cap; defaults to `window`. */
  maxDelay?: number;
  /** Writes the audit entry. */
  audit?: (entry: {
    action: AuditAction;
    label: string;
    detail: Record<string, unknown>;
  }) => void | Promise<void>;
  /** Clock of the default store. */
  now?: () => number;
  /** A failing store lets the attempt through; this receives the error. */
  onError?: (error: unknown) => void;
}

const DEFAULTS = { attempts: 5, window: 15 * 60_000 };

export function authGuard(options: AuthGuardOptions = {}): MiddlewareHandler {
  const store =
    options.store ?? memoryRateLimitStore(options.now ? { now: options.now } : undefined);
  const fixed = {
    attempts: options.attempts ?? DEFAULTS.attempts,
    window: options.window ?? DEFAULTS.window,
  };
  const policyOf = async (): Promise<BackoffPolicy | null> => {
    const policy = options.policy ? await options.policy() : fixed;
    if (!policy) return null;
    return { ...policy, maxDelay: options.maxDelay ?? policy.window };
  };
  const safely = async <T>(work: () => Promise<T> | T, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      options.onError?.(error);
      return fallback;
    }
  };

  return async (c, next) => {
    const route = c.req.path.slice(c.req.path.indexOf('/api/auth/') + '/api/auth/'.length);
    if (!GUARDED.some((prefix) => route.startsWith(prefix))) return next();
    const policy = await policyOf();
    if (!policy) return next();

    const ip = clientIp(c);
    // Read from a clone; the handler still needs the body.
    const account = await accountFrom(c.req.raw.clone());
    const keys = [
      `auth.signIn:ip:${ip}`,
      ...(account ? [`auth.signIn:account:${account.toLowerCase()}`] : []),
    ];

    const detail: Record<string, unknown> = { ip, route };
    const userAgent = c.req.header('user-agent');
    if (userAgent) detail.userAgent = userAgent.slice(0, 300);
    const requestId = c.get('requestId');
    if (requestId) detail.requestId = requestId;

    const wait = await safely(() => store.blocked(keys), 0);
    if (wait > 0) {
      const retryAfter = Math.ceil(wait / 1000);
      c.header('retry-after', String(retryAfter));
      await options.audit?.({
        action: 'session.signInFailed',
        label: account ?? ip,
        detail: { ...detail, reason: 'throttled', retryAfter },
      });
      return errorResponse(
        c,
        ManabloxError.rateLimited('auth.tooManyAttempts', { rule: 'auth.signIn', retryAfter }),
      );
    }

    await next();

    // Any 4xx counts as a failure, including malformed attempts.
    if (c.res.status >= 400 && c.res.status < 500) {
      await safely(() => store.fail(keys, policy), undefined);
      await options.audit?.({
        action: 'session.signInFailed',
        label: account ?? ip,
        detail: { ...detail, status: c.res.status },
      });
    } else if (c.res.ok) {
      await safely(() => store.clear(keys), undefined);
    }
  };
}

/** The email an attempt names, if any. Never throws. */
async function accountFrom(request: Request): Promise<string | null> {
  if (request.method !== 'POST') return null;
  if (!request.headers.get('content-type')?.includes('json')) return null;
  try {
    const body = (await request.json()) as { email?: unknown; newEmail?: unknown };
    const email = body.email ?? body.newEmail;
    return typeof email === 'string' && email.length <= 320 ? email : null;
  } catch {
    return null;
  }
}
