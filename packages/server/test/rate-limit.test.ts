import {
  type ControlScope,
  DefaultControls,
  type ManabloxConfig,
  type ResolvedControls,
} from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Runtime } from '../src/bootstrap.js';
import { allowedIpList } from '../src/control/auth.js';
import { clientIpResolver } from '../src/middleware/client-ip.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

type Rules = Partial<ResolvedControls['rateLimits']>;

/** Catalogue defaults, with `rules` set at `scope` for `spaceId` (every request when `null`). */
class RulesAt extends DefaultControls {
  constructor(
    private readonly rules: Rules,
    private readonly spaceId: string | null = null,
    private readonly scope: ControlScope = { kind: 'instance' },
  ) {
    super();
  }

  override async resolved(spaceId: string | null): Promise<ResolvedControls> {
    const base = await super.resolved(spaceId);
    if (this.spaceId !== null && spaceId !== this.spaceId) return base;
    const scopes = Object.fromEntries(Object.keys(this.rules).map((key) => [key, this.scope]));
    return {
      ...base,
      rateLimits: { ...base.rateLimits, ...this.rules },
      rateLimitScopes: { ...base.rateLimitScopes, ...scopes },
    };
  }
}

async function build(config: Partial<ManabloxConfig> = {}, controls?: DefaultControls) {
  const { runtime, manablox, calls } = stubRuntime(config);
  await initialised(runtime);
  if (controls) manablox.setControls(controls);
  return { app: await createApp(runtime), runtime, calls };
}

const get = (app: Hono, path: string, ip = '198.51.100.1', headers: Record<string, string> = {}) =>
  app.request(
    new Request(`http://api.test${path}`, { headers: { 'x-forwarded-for': ip, ...headers } }),
  );

const publicConfig = {
  server: { mode: 'public' as const },
  publicApi: { spaceId: ids.space },
  cache: { enabled: false },
} satisfies Partial<ManabloxConfig>;

describe('surface rate limits', () => {
  it('keeps the configured defaults and sends the RateLimit headers', async () => {
    const { app } = await build({ server: { rateLimit: { window: 60_000, max: 2 } } });
    const first = await get(app, '/healthz');
    expect(first.status).toBe(200);
    expect(first.headers.get('ratelimit-limit')).toBe('2');
    expect(first.headers.get('ratelimit-remaining')).toBe('1');
    expect(Number(first.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
    expect((await get(app, '/healthz')).headers.get('ratelimit-remaining')).toBe('0');

    const refused = await get(app, '/healthz');
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({
      error: {
        key: 'rateLimit.exceeded',
        status: 429,
        details: [
          { key: 'rateLimit.exceeded', params: { rule: 'management.session', retryAfter } },
        ],
      },
    });
    // Another client, and an API key, have their own budgets.
    expect((await get(app, '/healthz', '198.51.100.2')).status).toBe(200);
    const keyed = await get(app, '/healthz', '198.51.100.1', { 'x-api-key': 'mbx_test' });
    expect(keyed.status).toBe(200);
  });

  it("leaves the admin's hashed files alone on management", async () => {
    const { app } = await build({ server: { rateLimit: { window: 60_000, max: 1 } } });
    for (const path of ['/assets/index-abc.js', '/admin/plugins/hello/1a2b/entry.js']) {
      for (let i = 0; i < 3; i++) {
        const res = await get(app, path);
        expect(res.status).not.toBe(429);
        expect(res.headers.get('ratelimit-limit')).toBeNull();
      }
    }
    expect((await get(app, '/admin/plugins.json')).headers.get('ratelimit-limit')).toBe('1');
    expect((await get(app, '/admin/plugins.json')).status).toBe(429);
  });

  it('defaults to 600 a minute on management and to the public config on public', async () => {
    const management = await build();
    expect((await get(management.app, '/healthz')).headers.get('ratelimit-limit')).toBe('600');
    const publicApi = await build({
      ...publicConfig,
      publicApi: { spaceId: ids.space, rateLimit: { window: 60_000, max: 300 } },
    });
    expect((await get(publicApi.app, '/healthz')).headers.get('ratelimit-limit')).toBe('300');
  });

  it('lets a control value replace the config default, even when the config switched it off', async () => {
    const { app } = await build(
      { server: { rateLimit: false } },
      new RulesAt({ 'management.session': { max: 1, windowSeconds: 60 } }),
    );
    expect((await get(app, '/healthz')).headers.get('ratelimit-limit')).toBe('1');
    expect((await get(app, '/healthz')).status).toBe(429);

    const off = await build({ server: { rateLimit: false } });
    const free = await get(off.app, '/healthz');
    expect(free.status).toBe(200);
    expect(free.headers.get('ratelimit-limit')).toBeNull();
  });

  it('applies the pinned space rules on public: per IP and across IPs', async () => {
    const space: ControlScope = { kind: 'space', id: ids.space };
    const perIp = await build(
      publicConfig,
      new RulesAt({ 'delivery.ip': { max: 1, windowSeconds: 60 } }, ids.space, space),
    );
    expect((await get(perIp.app, '/healthz')).status).toBe(200);
    expect((await get(perIp.app, '/healthz')).status).toBe(429);

    const perSpace = await build(
      publicConfig,
      new RulesAt({ 'delivery.space': { max: 2, windowSeconds: 60 } }, ids.space, space),
    );
    expect((await get(perSpace.app, '/healthz', '203.0.113.1')).status).toBe(200);
    expect((await get(perSpace.app, '/healthz', '203.0.113.2')).status).toBe(200);
    const refused = await get(perSpace.app, '/healthz', '203.0.113.3');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      error: { details: [{ params: { rule: 'delivery.space' } }] },
    });

    // Another pinned space keeps the defaults.
    const other = await build(
      { ...publicConfig, publicApi: { spaceId: ids.otherSpace } },
      new RulesAt({ 'delivery.space': { max: 1, windowSeconds: 60 } }, ids.space, space),
    );
    expect((await get(other.app, '/healthz')).status).toBe(200);
    expect((await get(other.app, '/healthz')).status).toBe(200);
  });

  it('counts signed-in management requests per user once the principal is known', async () => {
    const { app, runtime } = await build(
      {},
      new RulesAt({ 'management.session': { max: 1, windowSeconds: 60 } }),
    );
    signedIn(runtime);
    const cookie = { cookie: 'better-auth.session_token=abc' };
    expect((await get(app, '/api/v1/nothing', '192.0.2.1', cookie)).status).not.toBe(429);
    // Same user, another address: still one budget.
    const refused = await get(app, '/api/v1/nothing', '192.0.2.2', cookie);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
    // Paths without a principal count per address.
    expect((await get(app, '/healthz', '192.0.2.3', cookie)).status).toBe(200);
  });
});

describe('upload rules', () => {
  const upload = (app: Hono) =>
    app.request(
      new Request(`http://api.test/upload/${ids.space}`, {
        method: 'POST',
        headers: { 'x-api-key': 'mbx_uploader', 'x-forwarded-for': '198.51.100.20' },
      }),
    );
  const uploader = (runtime: Runtime) =>
    Object.assign(runtime.apiKeys, {
      resolve: async () => ({
        userId: ids.user,
        email: 'key@example.com',
        role: 'superadmin',
        spaces: {},
        viaApiKey: true,
      }),
    });

  it('refuses past `uploads` and without a free `uploads.parallel` slot', async () => {
    const space: ControlScope = { kind: 'space', id: ids.space };
    const counted = await build(
      {},
      new RulesAt({ uploads: { max: 0, windowSeconds: 60 } }, ids.space, space),
    );
    uploader(counted.runtime);
    const refused = await upload(counted.app);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      error: { details: [{ params: { rule: 'uploads' } }] },
    });

    const parallel = await build(
      {},
      new RulesAt({ 'uploads.parallel': { max: 0 } }, ids.space, space),
    );
    uploader(parallel.runtime);
    const busy = await upload(parallel.app);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('5');
    expect(await busy.json()).toMatchObject({
      error: { details: [{ params: { rule: 'uploads.parallel', retryAfter: 5 } }] },
    });
  });
});

describe('graphql limits per space', () => {
  const query = (app: Hono) =>
    app.request(
      new Request('http://public.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ contentsPage { items { id } } }' }),
      }),
    );

  it('reads graphql.depth and graphql.complexity for the pinned space', async () => {
    const space: ControlScope = { kind: 'space', id: ids.space };
    const shallow = await build(
      publicConfig,
      new RulesAt({ 'graphql.depth': 1 }, ids.space, space),
    );
    const deep = await query(shallow.app);
    expect(JSON.stringify(await deep.json())).toContain('QUERY_TOO_DEEP');

    const cheap = await build(
      publicConfig,
      new RulesAt({ 'graphql.complexity': 2 }, ids.space, space),
    );
    expect(JSON.stringify(await (await query(cheap.app)).json())).toContain('QUERY_TOO_COMPLEX');

    // The defaults admit it; the validation cache does not carry a result across limits.
    const open = await build(publicConfig);
    const ok = await (await query(open.app)).json();
    expect(JSON.stringify(ok)).not.toContain('QUERY_TOO');
  });
});

describe('trusted proxies', () => {
  const peer = (address: string) => ({ incoming: { socket: { remoteAddress: address } } });
  const appWith = (trusted: string[] | null) => {
    const app = new Hono();
    const resolve = clientIpResolver(trusted ? allowedIpList(trusted) : null);
    app.get('/', (c) => c.text(resolve(c)));
    return async (headers: Record<string, string>, from: string) =>
      (await app.request('/', { headers }, peer(from))).text();
  };

  it('reads the headers of any peer while unset', async () => {
    const ip = appWith(null);
    expect(await ip({ 'x-forwarded-for': '203.0.113.5, 10.0.0.2' }, '10.0.0.1')).toBe(
      '203.0.113.5',
    );
    expect(await ip({ 'cf-connecting-ip': '203.0.113.6' }, '10.0.0.1')).toBe('203.0.113.6');
    expect(await ip({}, '10.0.0.1')).toBe('10.0.0.1');
  });

  it('reads the headers only from a trusted peer, walking X-Forwarded-For from the right', async () => {
    const ip = appWith(['10.0.0.0/8']);
    // An untrusted peer's headers are ignored.
    expect(await ip({ 'x-forwarded-for': '203.0.113.5' }, '198.51.100.7')).toBe('198.51.100.7');
    expect(await ip({ 'cf-connecting-ip': '203.0.113.6' }, '::ffff:198.51.100.7')).toBe(
      '::ffff:198.51.100.7',
    );
    // A spoofed first entry does not win over the hop the trusted proxy saw.
    expect(
      await ip({ 'x-forwarded-for': '1.2.3.4, 203.0.113.5, 10.0.0.3' }, '::ffff:10.0.0.1'),
    ).toBe('203.0.113.5');
    expect(await ip({ 'cf-connecting-ip': '203.0.113.6' }, '10.0.0.1')).toBe('203.0.113.6');
    expect(await ip({ 'x-real-ip': '203.0.113.8' }, '10.0.0.1')).toBe('203.0.113.8');
  });

  it('believes no header with an empty list', async () => {
    const ip = appWith([]);
    expect(await ip({ 'x-forwarded-for': '203.0.113.5' }, '10.0.0.1')).toBe('10.0.0.1');
  });

  it('refuses a bad TRUSTED_PROXIES entry at start', async () => {
    await expect(build({ server: { trustedProxies: ['10.0.0.0/33'] } })).rejects.toMatchObject({
      key: 'config.invalid',
      details: [{ key: 'config.server.trustedProxyInvalid' }],
    });
  });
});

/** Every session is the same editor. */
function signedIn(runtime: Runtime): void {
  Object.assign(runtime.auth.api, {
    getSession: async () => ({ user: { id: ids.user, email: 'editor@example.com' } }),
  });
  Object.assign(runtime.repos, {
    users: {
      ...(runtime.repos as { users?: object }).users,
      findPrincipal: async () => ({
        role: 'editor',
        spaces: {},
        permissions: {},
        banned: false,
      }),
    },
  });
}
