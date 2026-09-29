import type { Principal } from '@manablox/auth';
import { CLIENT_ID_HEADER } from '@manablox/core';
import { currentActor, currentClient } from '@manablox/core/node';
import { ids } from '@manablox/core/testing';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { describe, expect, it } from 'vitest';
import { errorResponse } from '../src/errors.js';
import {
  type PrincipalRuntime,
  principal,
  principalOf,
  requireSuperadmin,
} from '../src/middleware/principal.js';

const editor: Principal = {
  userId: 'u-bob',
  email: 'bob@example.com',
  role: 'editor',
  spaces: { [ids.space]: 'editor' },
};
const root: Principal = {
  ...editor,
  userId: 'u-root',
  email: 'root@example.com',
  role: 'superadmin',
};

/** A runtime whose session is `session`, with `x-api-key: restricted` a space-bound superadmin key. */
function runtime(session: Principal | null): PrincipalRuntime {
  let resolutions = 0;
  const stub = {
    auth: {
      api: {
        getSession: async () => {
          resolutions++;
          return session ? { user: { id: session.userId, email: session.email } } : null;
        },
      },
    },
    repos: {
      users: {
        findPrincipal: async () =>
          session ? { role: session.role, banned: false, spaces: session.spaces } : null,
      },
      audit: { record: async () => null },
    },
    apiKeys: {
      resolve: async (key: string) =>
        key === 'restricted'
          ? { ...root, viaApiKey: true, apiKeyName: 'ci', allowedSpaceIds: [ids.space] }
          : null,
    },
    get resolutions() {
      return resolutions;
    },
  };
  return stub as unknown as PrincipalRuntime;
}

function app(rt: PrincipalRuntime, options: Parameters<typeof principal>[1] = {}) {
  const hono = new Hono();
  hono.use('*', requestId());
  hono.onError((error, c) => errorResponse(c, error));
  hono.get('/who', principal(rt, options), (c) =>
    c.json({
      userId: principalOf(c)?.userId ?? null,
      actor: currentActor(),
      auditActor: c.get('auditActor') ?? null,
      client: currentClient(),
    }),
  );
  hono.get('/admin', principal(rt), requireSuperadmin, (c) => c.json({ ok: true }));
  return hono;
}

describe('principal()', () => {
  it('sets the principal and runs the handler as its actor and client', async () => {
    const res = await app(runtime(editor)).request('/who', {
      headers: { [CLIENT_ID_HEADER]: 'tab-1', 'user-agent': 'Test/1.0' },
    });
    const body = (await res.json()) as {
      userId: string;
      actor: { kind: string; id: string; detail: Record<string, unknown> };
      auditActor: unknown;
      client: string;
    };
    expect(body.userId).toBe('u-bob');
    expect(body.actor).toMatchObject({ kind: 'user', id: 'u-bob', label: 'bob@example.com' });
    expect(body.actor.detail).toMatchObject({ userAgent: 'Test/1.0' });
    expect(body.actor.detail.requestId).toEqual(expect.any(String));
    expect(body.auditActor).toEqual(body.actor);
    expect(body.client).toBe('tab-1');
  });

  it('acts as the anonymous system without a session', async () => {
    const res = await app(runtime(null)).request('/who');
    expect(await res.json()).toMatchObject({
      userId: null,
      actor: { kind: 'system', label: 'anonymous' },
      client: null,
    });
  });

  it('records an API key caller as the key', async () => {
    const res = await app(runtime(null)).request('/who', {
      headers: { 'x-api-key': 'restricted' },
    });
    expect(await res.json()).toMatchObject({
      userId: 'u-root',
      actor: { kind: 'apikey', id: 'u-root', detail: { apiKeyName: 'ci' } },
    });
  });

  it('skips resolution when `when` does not hold', async () => {
    const rt = runtime(editor);
    const res = await app(rt, { when: (c) => c.req.header('x-preview') !== undefined }).request(
      '/who',
    );
    expect(await res.json()).toMatchObject({ userId: null, auditActor: null });
    expect((rt as unknown as { resolutions: number }).resolutions).toBe(0);

    const preview = await app(rt, {
      when: (c) => c.req.header('x-preview') !== undefined,
    }).request('/who', { headers: { 'x-preview': '1' } });
    expect(await preview.json()).toMatchObject({ userId: 'u-bob' });
  });
});

describe('requireSuperadmin', () => {
  it('refuses the anonymous with 401 and other roles with 403', async () => {
    expect((await app(runtime(null)).request('/admin')).status).toBe(401);
    const res = await app(runtime(editor)).request('/admin');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { key: 'auth.superadminRequired' } });
  });

  it('lets a superadmin through', async () => {
    const res = await app(runtime(root)).request('/admin');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses a space-restricted key, even a superadmin owner', async () => {
    const res = await app(runtime(null)).request('/admin', {
      headers: { 'x-api-key': 'restricted' },
    });
    expect(res.status).toBe(403);
  });
});
