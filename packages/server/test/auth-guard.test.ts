import { memoryRateLimitStore } from '@manablox/cache';
import type { AuditAction } from '@manablox/core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { authGuard, backoffFor } from '../src/middleware/auth-guard.js';

/** Auth guard tests, with injected time. */

interface Entry {
  action: AuditAction;
  label: string;
  detail: Record<string, unknown>;
}

/** An app whose auth handler answers with the test's `outcome`. */
function build(options: { attempts?: number; outcome?: () => number } = {}) {
  const audited: Entry[] = [];
  let clock = 1_000_000;
  const app = new Hono();

  app.use(
    '/api/auth/*',
    authGuard({
      attempts: options.attempts ?? 2,
      window: 60_000,
      maxDelay: 30_000,
      now: () => clock,
      audit: (entry) => {
        audited.push(entry as Entry);
      },
    }),
  );
  app.all('/api/auth/*', (c) => c.json({ ok: true }, (options.outcome?.() ?? 401) as 401));

  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(
      new Request(`http://test${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.7',
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return { app, call, audited, advance: (ms: number) => (clock += ms) };
}

describe('backoff', () => {
  it('is free until the allowance is spent, then doubles up to the cap', () => {
    expect(backoffFor(1, 3, 30_000)).toBe(0);
    expect(backoffFor(3, 3, 30_000)).toBe(0);
    expect(backoffFor(4, 3, 30_000)).toBe(1_000);
    expect(backoffFor(5, 3, 30_000)).toBe(2_000);
    expect(backoffFor(6, 3, 30_000)).toBe(4_000);
    expect(backoffFor(40, 3, 30_000)).toBe(30_000);
  });
});

describe('auth guard', () => {
  it('refuses further attempts once the allowance is spent', async () => {
    const { call } = build({ attempts: 2 });
    const attempt = () => call('/api/auth/sign-in/email', { email: 'a@example.com' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    // The third failure sets the backoff; the fourth is refused before the handler.
    expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('1');
    expect(await blocked.json()).toEqual({
      error: {
        key: 'auth.tooManyAttempts',
        kind: 'rate_limited',
        status: 429,
        message: 'auth.tooManyAttempts',
        details: [{ key: 'auth.tooManyAttempts', params: { rule: 'auth.signIn', retryAfter: 1 } }],
      },
    });
  });

  it('lets the attempt through again once the backoff has passed', async () => {
    const { call, advance } = build({ attempts: 1 });
    await call('/api/auth/sign-in/email', { email: 'a@example.com' });
    await call('/api/auth/sign-in/email', { email: 'a@example.com' });
    expect((await call('/api/auth/sign-in/email', { email: 'a@example.com' })).status).toBe(429);

    advance(2_000);
    expect((await call('/api/auth/sign-in/email', { email: 'a@example.com' })).status).toBe(401);
  });

  it('counts the account as well as the address, so one account cannot be sprayed', async () => {
    const { app } = build({ attempts: 1 });
    const from = (ip: string) =>
      app.request(
        new Request('http://test/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
          body: JSON.stringify({ email: 'victim@example.com' }),
        }),
      );

    // Two different addresses, each within its own address allowance...
    expect((await from('198.51.100.1')).status).toBe(401);
    expect((await from('198.51.100.2')).status).toBe(401);
    // ...but the account they both name has spent its own.
    expect((await from('198.51.100.3')).status).toBe(429);
  });

  it('clears both buckets on a success, so a mistyped password is not a lockout', async () => {
    let status = 401;
    const { call } = build({ attempts: 1, outcome: () => status });

    await call('/api/auth/sign-in/email', { email: 'a@example.com' });
    status = 200;
    expect((await call('/api/auth/sign-in/email', { email: 'a@example.com' })).status).toBe(200);

    status = 401;
    // Success resets the allowance.
    expect((await call('/api/auth/sign-in/email', { email: 'a@example.com' })).status).toBe(401);
    expect((await call('/api/auth/sign-in/email', { email: 'a@example.com' })).status).toBe(401);
  });

  it('leaves the session routes the admin polls alone', async () => {
    const { app } = build({ attempts: 1 });
    const get = () => app.request(new Request('http://test/api/auth/get-session'));

    for (let index = 0; index < 10; index++) expect((await get()).status).toBe(401);
  });

  it('records every refusal, with the account and address but never the password', async () => {
    const { call, audited } = build({ attempts: 1 });
    await call('/api/auth/sign-in/email', {
      email: 'a@example.com',
      password: 'hunter2',
    });

    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      action: 'session.signInFailed',
      label: 'a@example.com',
      detail: { ip: '203.0.113.7', route: 'sign-in/email', status: 401 },
    });
    expect(JSON.stringify(audited[0])).not.toContain('hunter2');
  });

  it('records a throttled attempt as its own reason', async () => {
    const { call, audited } = build({ attempts: 1 });
    await call('/api/auth/sign-in/email', { email: 'a@example.com' });
    await call('/api/auth/sign-in/email', { email: 'a@example.com' });
    await call('/api/auth/sign-in/email', { email: 'a@example.com' });

    const throttled = audited.filter((entry) => entry.detail.reason === 'throttled');
    expect(throttled).toHaveLength(1);
    expect(throttled[0]?.detail).toMatchObject({ retryAfter: 1 });
  });

  it('guards the password-reset routes as well as sign-in', async () => {
    const { call } = build({ attempts: 1 });
    await call('/api/auth/forget-password', { email: 'a@example.com' });
    await call('/api/auth/forget-password', { email: 'a@example.com' });
    expect((await call('/api/auth/forget-password', { email: 'a@example.com' })).status).toBe(429);
  });

  it('still counts an attempt whose body it cannot read', async () => {
    const { app } = build({ attempts: 1 });
    const attempt = () =>
      app.request(
        new Request('http://test/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'x-real-ip': '192.0.2.9' },
          body: 'not json',
        }),
      );

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it('shares failures through the store, so replicas back off together', async () => {
    const store = memoryRateLimitStore();
    const replica = () => {
      const app = new Hono();
      app.use('/api/auth/*', authGuard({ store, attempts: 1 }));
      app.all('/api/auth/*', (c) => c.json({ ok: false }, 401));
      return (ip: string) =>
        app.request(
          new Request('http://test/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
            body: JSON.stringify({ email: 'shared@example.com' }),
          }),
        );
    };
    const a = replica();
    const b = replica();
    expect((await a('198.51.100.1')).status).toBe(401);
    expect((await b('198.51.100.2')).status).toBe(401);
    expect((await a('198.51.100.3')).status).toBe(429);
  });

  it('follows the auth.signIn rule, and stays out of the way without one', async () => {
    let policy: { attempts: number; window: number } | null = { attempts: 1, window: 60_000 };
    const app = new Hono();
    app.use('/api/auth/*', authGuard({ policy: async () => policy }));
    app.all('/api/auth/*', (c) => c.json({ ok: false }, 401));
    const attempt = () =>
      app.request(
        new Request('http://test/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.44' },
          body: JSON.stringify({ email: 'rule@example.com' }),
        }),
      );
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
    policy = null;
    expect((await attempt()).status).toBe(401);
  });

  it('lets attempts through when the store fails', async () => {
    const failing = memoryRateLimitStore();
    failing.blocked = () => {
      throw new Error('redis down');
    };
    const errors: unknown[] = [];
    const app = new Hono();
    app.use(
      '/api/auth/*',
      authGuard({ store: failing, attempts: 0, onError: (error) => errors.push(error) }),
    );
    app.all('/api/auth/*', (c) => c.json({ ok: false }, 401));
    const response = await app.request(
      new Request('http://test/api/auth/sign-in/email', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
    expect(errors).toHaveLength(1);
  });

  it('leaves the request body readable by the handler behind it', async () => {
    const seen: unknown[] = [];
    const app = new Hono();
    app.use('/api/auth/*', authGuard({ attempts: 5 }));
    app.all('/api/auth/*', async (c) => {
      seen.push(await c.req.json());
      return c.json({ ok: true });
    });

    await app.request(
      new Request('http://test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com', password: 'x' }),
      }),
    );
    expect(seen).toEqual([{ email: 'a@example.com', password: 'x' }]);
  });
});
