import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { definePlugin, ManabloxError, type RequestServed } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import { createApp } from '../src/app.js';
import {
  bootstrap,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '../src/bootstrap.js';
import {
  type PluginMiddleware,
  type PluginMiddlewareOrder,
  pluginServer,
} from '../src/surfaces/plugins.js';
import { hostedPlugin } from './helpers/hosted-mode.js';
import { stubRuntime } from './helpers/runtime.js';

const KEY = 'plugin-routes-key-0123456789abcdef';
const ADMIN = 'https://admin.plugins.test';
const PASSWORD = 'plugin-password-123';
const BASE = '/plugins/test.routes';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let site: Runtime;
let pub: Runtime;
let apiApp: Hono;
let siteApp: Hono;
let pubApp: Hono;
let spaceId: string;
let otherId: string;
let rootKey: string;
let readKey: string;
let otherSpaceKey: string;
let editorCookie: string;

/** What the plugin's middleware saw, in order. */
const trace: string[] = [];

const middleware = (order: PluginMiddlewareOrder): PluginMiddleware => ({
  scopes: ['management'],
  order,
  handler: async (c, next, helpers) => {
    if (c.req.path.startsWith(BASE) || c.req.path.startsWith('/api/v1/')) {
      const caller = await helpers.principal(c);
      trace.push(`${order}:${caller?.email ?? 'anon'}`);
    }
    await next();
    c.header(`x-${order.toLowerCase()}`, '1');
  },
});

const plugin = definePlugin({
  name: '@test/routes',
  server: pluginServer({
    routes: [
      {
        scopes: ['management', 'public', 'hosted'],
        register(app, helpers) {
          app.get('/whoami', async (c) => {
            const caller = await helpers.principal(c);
            return c.json({ scope: helpers.scope, email: caller?.email ?? null });
          });
          app.get('/space', async (c) => c.json({ spaceId: await helpers.requireSpace(c) }));
          app.post('/space', async (c) => c.json({ spaceId: await helpers.requireSpace(c) }));
          app.get('/spaces/:spaceId/publish', async (c) => {
            const caller = await helpers.requirePermission(c, 'content:publish');
            return c.json({ email: caller.email, spaceId: c.req.param('spaceId') });
          });
          app.get('/spaces/:spaceId/roles', async (c) => {
            await helpers.requirePermission(c, 'role:write');
            return c.json({ ok: true });
          });
          app.get('/instance', async (c) => {
            await helpers.requirePermission(c, 'space:write', null);
            return c.json({ ok: true });
          });
          app.get('/trace', (c) => {
            trace.push('route');
            return c.json({ trace });
          });
          app.get('/boom', () => {
            throw new Error('secret detail');
          });
          app.get('/refuse', () => {
            throw ManabloxError.conflict('space.machineName.taken', { machineName: 'x' });
          });
        },
      },
    ],
    middleware: [middleware('beforeRoutes'), middleware('afterAuth'), middleware('beforeAuth')],
  }),
});

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const settle = () => {
  for (const runtime of [api, site, pub]) runtime.controlStore.forget(null);
};

const control = async (path: string, method: string, body?: unknown) => {
  const response = await apiApp.request(`/control/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.status).toBeLessThan(300);
  settle();
};

/** Off is hidden here; the lock has tests of its own. */
const setFlag = (scope: string, enabled: boolean | null) =>
  enabled === null
    ? control(`/settings/features.plugins.test.routes?scope=${scope}`, 'DELETE')
    : control(`/settings?scope=${scope}`, 'PATCH', {
        'features.plugins.test.routes': enabled ? { enabled } : { enabled, presentation: 'hidden' },
      });

const setState = (scope: string, state: { status: string } | null) =>
  state === null
    ? control(`/settings/state?scope=${scope}`, 'DELETE')
    : scope === 'instance'
      ? control('/instance/state', 'PUT', state)
      : control(`/settings?scope=${scope}`, 'PATCH', { state });

let ipSeq = 0;
const call = (
  path: string,
  headers: Record<string, string> = {},
  init: { method?: string; app?: Hono; host?: string } = {},
) =>
  (init.app ?? apiApp).request(
    new Request(`http://${init.host ?? 'api.plugins.test'}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'x-forwarded-for': `198.51.100.${(++ipSeq % 250) + 1}`, ...headers },
    }),
  );

const withKey = (key: string, headers: Record<string, string> = {}) => ({
  'x-api-key': key,
  ...headers,
});

beforeAll(async () => {
  db = await createTestDatabase('server_plugin_routes');
  dir = await mkdtemp(join(tmpdir(), 'manablox-plugin-routes-'));
  const config = {
    database: { url: db.url },
    auth: { secret: 'plugin-routes-secret', trustedOrigins: [ADMIN] },
    fieldTypes: builtinFieldTypes,
    contentTypes: [{ name: 'page', fields: [{ name: 'body', type: 'string' }] }],
    plugins: [plugin, hostedPlugin],
    logLevel: 'silent' as const,
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  };
  const rateLimit = { window: 60_000, max: 10_000 };
  api = requireManagement(
    await bootstrap({
      ...config,
      server: {
        adminUrl: ADMIN,
        rateLimit,
        scopes: ['rpc', 'auth', 'uploads', 'media', 'graphql', 'control'],
      },
      control: { apiKey: KEY },
    }),
  );
  apiApp = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@plugins.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  const create = async (name: string) => {
    const space = await api.repos.spaces.create({
      name,
      machineName: name,
      url: `https://${name}.front.test`,
      defaultLocale: 'en',
      locales: ['en'],
    });
    await api.apiHosts.create(space.id, `${name}.test`);
    return space.id;
  };
  spaceId = await create('plugged');
  otherId = await create('unplugged');

  rootKey = (await api.apiKeys.issue(admin.id, 'root')).key;
  readKey = (await api.apiKeys.issue(admin.id, 'read', { permissions: ['content:read'] })).key;
  otherSpaceKey = (await api.apiKeys.issue(admin.id, 'other', { spaceIds: [otherId] })).key;

  const editor = await api.users.create({
    name: 'Editor',
    email: 'editor@plugins.test',
    password: PASSWORD,
    role: 'editor',
  });
  await api.spaces.grant(spaceId, editor.id, 'editor');
  const signIn = await apiApp.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ADMIN },
    body: JSON.stringify({ email: editor.email, password: PASSWORD }),
  });
  expect(signIn.status).toBe(200);
  editorCookie = signIn.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');

  site = await bootstrap({ ...config, server: { mode: 'hosted', rateLimit } });
  siteApp = await createApp(site);
  pub = await bootstrap({
    ...config,
    server: { mode: 'public', rateLimit },
    publicApi: { spaceId },
  });
  pubApp = await createApp(pub);
}, 60_000);

beforeEach(() => {
  trace.length = 0;
});

afterEach(async () => {
  for (const scope of ['instance', `space:${spaceId}`, `space:${otherId}`]) {
    await setFlag(scope, null);
    await setState(scope, null);
  }
});

afterAll(async () => {
  await pub?.shutdown();
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('plugin route helpers', () => {
  it('resolves the caller: anonymous, session and API key', async () => {
    expect(await json(await call(`${BASE}/whoami`))).toEqual({
      scope: 'management',
      email: null,
    });
    expect(await json(await call(`${BASE}/whoami`, { cookie: editorCookie }))).toMatchObject({
      email: 'editor@plugins.test',
    });
    expect(await json(await call(`${BASE}/whoami`, withKey(rootKey)))).toMatchObject({
      email: 'admin@plugins.test',
    });
  });

  it('answers 401 and 403 in the standard shape, and passes with the permission', async () => {
    const publish = `${BASE}/spaces/${spaceId}/publish`;
    const anon = await call(publish);
    expect(anon.status).toBe(401);
    expect((await json(anon)).error).toMatchObject({ key: 'auth.unauthorized', status: 401 });

    const editorOk = await call(publish, { cookie: editorCookie });
    expect(editorOk.status).toBe(200);
    expect(await json(editorOk)).toEqual({ email: 'editor@plugins.test', spaceId });

    const editorRefused = await call(`${BASE}/spaces/${spaceId}/roles`, { cookie: editorCookie });
    expect(editorRefused.status).toBe(403);
    expect((await json(editorRefused)).error).toMatchObject({
      key: 'auth.forbidden',
      details: [{ params: { permission: 'role:write', spaceId } }],
    });

    expect((await call(publish, withKey(rootKey))).status).toBe(200);
    expect((await call(publish, withKey(readKey))).status).toBe(403);
    expect((await call(publish, withKey(otherSpaceKey))).status).toBe(403);

    // Instance-wide: a superadmin passes, a space editor does not.
    expect((await call(`${BASE}/instance`, withKey(rootKey))).status).toBe(200);
    expect((await call(`${BASE}/instance`, { cookie: editorCookie })).status).toBe(403);
  });

  it('resolves the space from the header, path or query and validates it', async () => {
    const missing = await call(`${BASE}/space`);
    expect(missing.status).toBe(400);
    expect((await json(missing)).error).toMatchObject({ key: 'plugin.space.required' });

    expect(await json(await call(`${BASE}/space`, { 'x-manablox-space': spaceId }))).toEqual({
      spaceId,
    });
    expect(await json(await call(`${BASE}/space?spaceId=${otherId}`))).toEqual({
      spaceId: otherId,
    });

    const unknown = await call(`${BASE}/space`, {
      'x-manablox-space': '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.status).toBe(404);
    expect((await json(unknown)).error).toMatchObject({ key: 'space.notFound' });
    expect((await call(`${BASE}/space`, { 'x-manablox-space': 'nope' })).status).toBe(404);
  });

  it('serves the pinned space on public and the host space on a plugin mode, anonymously', async () => {
    expect(await json(await call(`${BASE}/space`, {}, { app: pubApp }))).toEqual({ spaceId });
    expect(await json(await call(`${BASE}/whoami`, withKey(rootKey), { app: pubApp }))).toEqual({
      scope: 'public',
      email: null,
    });
    const onSite = await call(`${BASE}/space`, {}, { app: siteApp, host: 'unplugged.test' });
    expect(await json(onSite)).toEqual({ spaceId: otherId });
  });

  it('answers unknown plugin paths with the standard 404', async () => {
    const response = await call(`${BASE}/missing`);
    expect(response.status).toBe(404);
    expect((await json(response)).error).toMatchObject({ key: 'route.notFound' });
  });
});

describe('the plugin flag', () => {
  it('hides the routes and middleware when off for the instance', async () => {
    await setFlag('instance', false);
    const off = await call(`${BASE}/whoami`);
    expect(off.status).toBe(404);
    expect((await json(off)).error).toMatchObject({ key: 'route.notFound' });
    expect((await call(`${BASE}/whoami`, {}, { app: pubApp })).status).toBe(404);
    expect((await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'plugged.test' })).status).toBe(
      404,
    );

    const other = await call('/api/v1/nothing', withKey(rootKey));
    expect(other.headers.get('x-beforeauth')).toBeNull();
    expect(trace).toEqual([]);
  });

  it('hides the routes in a space where it is off', async () => {
    await setFlag(`space:${otherId}`, false);
    expect((await call(`${BASE}/whoami`, { 'x-manablox-space': otherId })).status).toBe(404);
    expect((await call(`${BASE}/whoami?spaceId=${otherId}`)).status).toBe(404);
    expect((await call(`${BASE}/whoami`, { 'x-manablox-space': spaceId })).status).toBe(200);
    expect((await call(`${BASE}/whoami`)).status).toBe(200);

    // A path param is checked by `requireSpace`.
    const byPath = await call(`${BASE}/spaces/${otherId}/publish`, withKey(rootKey));
    expect(byPath.status).toBe(404);
    expect((await json(byPath)).error).toMatchObject({ key: 'route.notFound' });

    expect(
      (await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'unplugged.test' })).status,
    ).toBe(404);
    expect((await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'plugged.test' })).status).toBe(
      200,
    );
  });

  it('refuses the routes with the lock while locked, and hides the middleware', async () => {
    await control('/settings?scope=instance', 'PATCH', {
      'features.plugins.test.routes': {
        enabled: false,
        presentation: 'locked',
        message: 'Routes need a license',
        link: 'https://licenses.test/buy',
      },
    });
    const lock = {
      key: 'control.feature',
      details: [
        expect.objectContaining({
          params: expect.objectContaining({
            feature: 'plugins.test.routes',
            message: 'Routes need a license',
            link: 'https://licenses.test/buy',
          }),
        }),
      ],
    };
    for (const response of [
      await call(`${BASE}/whoami`),
      await call(`${BASE}/whoami`, {}, { app: pubApp }),
      await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'plugged.test' }),
    ]) {
      expect(response.status).toBe(403);
      expect((await json(response)).error).toMatchObject(lock);
    }
    expect(
      (await call('/api/v1/nothing', withKey(rootKey))).headers.get('x-beforeauth'),
    ).toBeNull();
  });

  it('refuses the routes with the lock in a space where it is locked', async () => {
    await control(`/settings?scope=space:${otherId}`, 'PATCH', {
      'features.plugins.test.routes': { enabled: false, presentation: 'locked' },
    });
    const byHeader = await call(`${BASE}/whoami`, { 'x-manablox-space': otherId });
    expect(byHeader.status).toBe(403);
    expect((await json(byHeader)).error).toMatchObject({ key: 'control.feature' });

    // A path param is checked by `requireSpace`.
    const byPath = await call(`${BASE}/spaces/${otherId}/publish`, withKey(rootKey));
    expect(byPath.status).toBe(403);
    expect((await json(byPath)).error).toMatchObject({ key: 'control.feature' });

    expect((await call(`${BASE}/whoami`, { 'x-manablox-space': spaceId })).status).toBe(200);
  });
});

describe('instance state', () => {
  it('keeps reads and refuses writes while read-only', async () => {
    await setState('instance', { status: 'readOnly' });
    expect((await call(`${BASE}/space`, { 'x-manablox-space': spaceId })).status).toBe(200);
    const write = await call(`${BASE}/space`, { 'x-manablox-space': spaceId }, { method: 'POST' });
    expect(write.status).toBe(423);
    expect((await json(write)).error).toMatchObject({ key: 'control.readOnly' });
  });

  it('refuses writes in a read-only space only', async () => {
    await setState(`space:${otherId}`, { status: 'readOnly' });
    const post = (space: string) =>
      call(`${BASE}/space`, { 'x-manablox-space': space }, { method: 'POST' });
    expect((await post(otherId)).status).toBe(423);
    expect((await post(spaceId)).status).toBe(200);
  });

  it('refuses management routes and hides public and plugin mode ones while suspended', async () => {
    await setState('instance', { status: 'suspended' });
    const refused = await call(`${BASE}/trace`, { cookie: editorCookie });
    expect(refused.status).toBe(423);
    expect((await json(refused)).error).toMatchObject({ key: 'control.suspended' });
    // `afterAuth` runs before the gate, `beforeRoutes` after it.
    expect(trace).toEqual(['beforeAuth:anon', 'afterAuth:editor@plugins.test']);

    expect((await call(`${BASE}/whoami`, {}, { app: pubApp })).status).toBe(503);
    expect((await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'plugged.test' })).status).toBe(
      503,
    );
  });
});

describe('rate limits, errors and metering', () => {
  it('sends the rate-limit headers on every scope', async () => {
    for (const response of [
      await call(`${BASE}/whoami`),
      await call(`${BASE}/whoami`, withKey(rootKey)),
      await call(`${BASE}/whoami`, { cookie: editorCookie }),
      await call(`${BASE}/whoami`, {}, { app: pubApp }),
      await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'plugged.test' }),
    ]) {
      expect(response.status).toBe(200);
      expect(response.headers.get('ratelimit-limit')).toBe('10000');
    }
  });

  it('answers errors in the standard shape, masked on public', async () => {
    const boom = await call(`${BASE}/boom`);
    expect(boom.status).toBe(500);
    expect((await json(boom)).error).toMatchObject({ key: 'internal.error', status: 500 });

    const refused = await call(`${BASE}/refuse`);
    expect(refused.status).toBe(409);
    expect((await json(refused)).error).toMatchObject({ key: 'space.machineName.taken' });

    const masked = await call(`${BASE}/boom`, {}, { app: pubApp });
    expect(masked.status).toBe(500);
    expect(JSON.stringify(await json(masked))).not.toContain('secret detail');

    const onSite = await call(`${BASE}/refuse`, {}, { app: siteApp, host: 'plugged.test' });
    expect(onSite.status).toBe(409);
    expect((await json(onSite)).error).toMatchObject({ key: 'space.machineName.taken' });
  });

  it('meters public routes as delivery and mode routes as the mode, not management ones', async () => {
    const seen = new Map<Runtime, RequestServed[]>();
    const offs = [api, pub, site].map((runtime) => {
      seen.set(runtime, []);
      return runtime.manablox.hooks.on('request:served', (payload) => {
        seen.get(runtime)?.push(payload);
      });
    });
    try {
      await (await call(`${BASE}/whoami`, withKey(rootKey))).arrayBuffer();
      await (await call(`${BASE}/whoami`, {}, { app: pubApp })).arrayBuffer();
      await (
        await call(`${BASE}/whoami`, {}, { app: siteApp, host: 'plugged.test' })
      ).arrayBuffer();

      await vi.waitFor(() => {
        expect(seen.get(pub)).toEqual([expect.objectContaining({ surface: 'delivery', spaceId })]);
        expect(seen.get(site)).toEqual([expect.objectContaining({ surface: 'hosted', spaceId })]);
      });
      expect(seen.get(api)).toEqual([]);
    } finally {
      for (const off of offs) off();
    }
  });
});

describe('plugin middleware', () => {
  it('runs in its declared order around the core stack, on every path of its scope', async () => {
    const response = await call(`${BASE}/trace`, { cookie: editorCookie });
    expect(await json(response)).toEqual({
      trace: [
        'beforeAuth:anon',
        'afterAuth:editor@plugins.test',
        'beforeRoutes:editor@plugins.test',
        'route',
      ],
    });
    for (const order of ['beforeauth', 'afterauth', 'beforeroutes']) {
      expect(response.headers.get(`x-${order}`)).toBe('1');
    }

    const core = await call('/api/v1/nothing', withKey(rootKey));
    expect(core.headers.get('x-beforeroutes')).toBe('1');
    expect(trace.slice(-3)).toEqual([
      'beforeAuth:anon',
      'afterAuth:admin@plugins.test',
      'beforeRoutes:admin@plugins.test',
    ]);

    const onPublic = await call(`${BASE}/whoami`, {}, { app: pubApp });
    expect(onPublic.headers.get('x-beforeauth')).toBeNull();
  });
});

describe('plugin helpers', () => {
  it('types plugin.services by the plugin', () => {
    const services = () => ({ greet: (name: string) => `Hello ${name}` });
    definePlugin({
      name: 'typed',
      services,
      server: {
        middleware: [
          {
            scopes: ['management'],
            order: 'afterAuth',
            handler: (_c, next, helpers) => {
              expectTypeOf(helpers.plugin.services.greet).toEqualTypeOf<(name: string) => string>();
              return next();
            },
          },
        ],
      },
    });
    pluginServer<ReturnType<typeof services>>({
      routes: [
        {
          scopes: ['management'],
          register: (_app, helpers) => {
            expectTypeOf(helpers.plugin.services.greet).toEqualTypeOf<(name: string) => string>();
          },
        },
      ],
    });
  });
});

describe('plugin ids', () => {
  it('refuses two route plugins with one id at start', async () => {
    const routes = pluginServer({ routes: [{ scopes: ['management'], register: () => {} }] });
    const { runtime } = stubRuntime({
      plugins: [
        definePlugin({ name: '@acme/seo', server: routes }),
        definePlugin({ name: 'acme/seo', server: routes }),
      ],
    });
    await expect(createApp(runtime)).rejects.toMatchObject({ key: 'plugin.id.duplicate' });
  });
});
