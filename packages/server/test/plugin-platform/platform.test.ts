import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginRouterClient } from '@manablox/api-rpc/plugin';
import { describeControls, permissionGroups, permissionsFor, resolveConfig } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { createORPCClient, ORPCError } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../../src/bootstrap.js';
import { helloRepos } from '../fixtures/plugins/hello/db.js';
import { helloPlugin } from '../fixtures/plugins/hello/plugin.js';
import type { HelloRouter } from '../fixtures/plugins/hello/rpc.js';

const KEY = 'hello-platform-key-0123456789abcdef';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Awaited<ReturnType<typeof createApp>>;
let spaceId: string;
let rootKey: string;
let readKey: string;
let writeKey: string;

type Client = PluginRouterClient<HelloRouter>;

/** The management client's `plugins.hello`, as an API key. */
const client = (key: string): Client => {
  const link = new RPCLink({
    url: 'http://hello.test/rpc',
    headers: { 'x-api-key': key },
    fetch: async (request) => app.request(request),
  });
  return (createORPCClient(link) as { plugins: { hello: Client } }).plugins.hello;
};

const control = async (path: string, method: string, body?: unknown) => {
  const response = await app.request(`/control/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  expect(response.status).toBeLessThan(300);
  api.controlStore.forget(null);
  return response;
};

const set = (scope: string, values: Record<string, unknown>) =>
  control(`/settings?scope=${scope}`, 'PATCH', values);
const unset = (scope: string, key: string) => control(`/settings/${key}?scope=${scope}`, 'DELETE');

/** The rejection's oRPC code and transport body. */
const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ORPCError);
  const { code, data } = error as ORPCError<string, { key: string; message: string }>;
  return { code, key: data.key, message: data.message };
};

beforeAll(async () => {
  db = await createTestDatabase('hello_platform', { plugins: [helloPlugin()] });
  dir = await mkdtemp(join(tmpdir(), 'manablox-hello-'));
  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'hello-platform-secret' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [{ name: 'page', fields: [{ name: 'body', type: 'string' }] }],
      plugins: [helloPlugin({ greetOn: ['page'] })],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: {
        rateLimit: { window: 60_000, max: 10_000 },
        scopes: ['rpc', 'auth', 'control'],
      },
      control: { apiKey: KEY },
    }),
  );
  app = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@hello.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  const space = await api.repos.spaces.create({
    name: 'Hello',
    machineName: 'hello',
    url: 'https://hello.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
  rootKey = (await api.apiKeys.issue(admin.id, 'root')).key;
  readKey = (await api.apiKeys.issue(admin.id, 'read', { permissions: ['space:read'] })).key;
  writeKey = (
    await api.apiKeys.issue(admin.id, 'write', { permissions: ['space:read', 'hello:write'] })
  ).key;
}, 60_000);

afterEach(async () => {
  for (const key of [
    'features.plugins.hello',
    'features.plugins.hello.shout',
    'limits.plugins.hello.greetings',
  ]) {
    for (const scope of ['instance', `space:${spaceId}`]) await unset(scope, key);
  }
});

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the hello plugin on the platform', () => {
  it('adds its permission to the catalogue and to the roles it names', async () => {
    expect(permissionsFor('owner')).toContain('hello:write');
    expect(permissionsFor('admin')).toContain('hello:write');
    expect(permissionsFor('editor')).toContain('hello:write');
    expect(permissionsFor('viewer')).not.toContain('hello:write');
    expect(permissionGroups().at(-1)).toMatchObject({
      id: 'plugins.hello',
      label: 'hello',
      permissions: [{ id: 'hello:write', label: 'Add greetings' }],
    });
    const role = await api.roles.create(spaceId, {
      name: 'Greeter',
      machineName: 'greeter',
      permissions: ['hello:write'],
    });
    expect(role.permissions).toContain('hello:write');
  });

  it('declares its controls, audit entity and error key', async () => {
    const keys = describeControls().map((control) => control.key);
    expect(keys).toContain('features.plugins.hello.shout');
    expect(keys).toContain('limits.plugins.hello.greetings');
    const catalogue = await (await control('/catalogue', 'GET')).json();
    expect(catalogue.controls).toContainEqual(
      expect.objectContaining({ key: 'limits.plugins.hello.greetings', kind: 'limit' }),
    );
    expect(api.audit.catalog().targetKinds).toContainEqual({
      id: 'hello.greeting',
      label: 'hello.greeting',
    });
  });

  it('lists and creates greetings through its router, audited', async () => {
    const hello = client(rootKey);
    const created = await hello.greetings.create({ spaceId, message: 'Hello there' });
    expect(created).toMatchObject({ spaceId, message: 'Hello there' });
    expect(await hello.greetings.list({ spaceId })).toContainEqual(created);
    const entries = await api.audit.list(spaceId, { actions: ['hello.greeting.create'] });
    expect(entries.items[0]).toMatchObject({
      action: 'hello.greeting.create',
      targetKind: 'hello.greeting',
      targetId: created.id,
      targetLabel: 'Hello there',
    });
  });

  it('serves its route with the typed services', async () => {
    const created = await client(rootKey).greetings.create({ spaceId, message: 'Via route' });
    const get = (key: string) =>
      app.request(`/plugins/hello/greetings?spaceId=${spaceId}`, {
        headers: { 'x-api-key': key },
      });
    const response = await get(readKey);
    expect(response.status).toBe(200);
    expect(await response.json()).toContainEqual(expect.objectContaining({ id: created.id }));
    // Off shows a lock by default: the route is refused with it; hidden, it is absent.
    await set(`space:${spaceId}`, { 'features.plugins.hello': { enabled: false } });
    const locked = await get(readKey);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ error: { key: 'control.feature' } });
    await set(`space:${spaceId}`, {
      'features.plugins.hello': { enabled: false, presentation: 'hidden' },
    });
    expect((await get(readKey)).status).toBe(404);
  });

  it('refuses while the plugin is off for the space or the instance', async () => {
    const hello = client(rootKey);
    await set(`space:${spaceId}`, { 'features.plugins.hello': { enabled: false } });
    // Off shows a lock by default: the call is refused with it.
    expect(await refusal(hello.greetings.list({ spaceId }))).toMatchObject({
      code: 'FORBIDDEN',
      key: 'control.feature',
    });
    await set(`space:${spaceId}`, {
      'features.plugins.hello': { enabled: false, presentation: 'hidden' },
    });
    expect(await refusal(hello.greetings.list({ spaceId }))).toMatchObject({
      code: 'NOT_FOUND',
      key: 'route.notFound',
    });
    await unset(`space:${spaceId}`, 'features.plugins.hello');
    await set('instance', { 'features.plugins.hello': { enabled: false } });
    expect(await refusal(hello.greetings.create({ spaceId, message: 'Hi' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('answers a procedure marked locked while the plugin is locked, not while hidden', async () => {
    const hello = client(rootKey);
    await set(`space:${spaceId}`, { 'features.plugins.hello': { enabled: false } });
    expect(await hello.greetings.count({ spaceId })).toBeTypeOf('number');
    expect(await refusal(hello.greetings.list({ spaceId }))).toMatchObject({ code: 'FORBIDDEN' });
    await set(`space:${spaceId}`, {
      'features.plugins.hello': { enabled: false, presentation: 'hidden' },
    });
    expect(await refusal(hello.greetings.count({ spaceId }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('checks its permission, which API keys can grant', async () => {
    expect(
      await refusal(client(readKey).greetings.create({ spaceId, message: 'Hi' })),
    ).toMatchObject({ code: 'FORBIDDEN', key: 'auth.forbidden' });
    expect(await client(readKey).greetings.list({ spaceId })).toBeInstanceOf(Array);
    expect(await client(writeKey).greetings.create({ spaceId, message: 'Hi' })).toMatchObject({
      message: 'Hi',
    });
  });

  it('enforces its limit with its own counter', async () => {
    const hello = client(rootKey);
    const { greetings } = helloRepos(api.repos);
    const used = await greetings.countBySpace(spaceId);
    await set(`space:${spaceId}`, { 'limits.plugins.hello.greetings': { max: used + 1 } });
    await hello.greetings.create({ spaceId, message: 'One more' });
    expect(await refusal(hello.greetings.create({ spaceId, message: 'Too many' }))).toMatchObject({
      code: 'CONFLICT',
      key: 'control.limit',
    });
  });

  it('refuses with its own error key while its feature is off', async () => {
    const hello = client(rootKey);
    expect(await hello.greetings.create({ spaceId, message: 'HELLO' })).toMatchObject({
      message: 'HELLO',
    });
    await set(`space:${spaceId}`, { 'features.plugins.hello.shout': { enabled: false } });
    expect(await refusal(hello.greetings.create({ spaceId, message: 'HELLO' }))).toEqual({
      code: 'FORBIDDEN',
      key: 'plugins.hello.shoutingOff',
      message: 'Greetings in capitals are switched off in this space.',
    });
  });

  it('runs its jobs, skipping a space where it is off', async () => {
    const { greetings } = helloRepos(api.repos);
    const before = await greetings.countBySpace(spaceId);
    await api.jobs.enqueue('hello:greet', { spaceId, message: 'From a job' });
    await api.jobs.idle();
    expect(await greetings.countBySpace(spaceId)).toBe(before + 1);
    await set(`space:${spaceId}`, { 'features.plugins.hello': { enabled: false } });
    await api.jobs.enqueue('hello:greet', { spaceId, message: 'Skipped' });
    await api.jobs.idle();
    expect(await greetings.countBySpace(spaceId)).toBe(before + 1);
    await api.jobs.enqueue('hello:tally', {});
    await api.jobs.idle();
  });

  it('describes itself to the admin', async () => {
    const response = await app.request('/rpc/instance/plugins', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': rootKey },
      body: JSON.stringify({}),
    });
    const [hello] = ((await response.json()) as { json: Array<Record<string, unknown>> }).json;
    expect(hello).toMatchObject({
      id: 'hello',
      feature: 'plugins.hello',
      permissions: [{ key: 'hello:write', label: 'Add greetings' }],
      nouns: { 'plugins.hello.greetings': ['greeting', 'greetings'] },
      errors: {
        'plugins.hello.shoutingOff': 'Greetings in capitals are switched off in this space.',
      },
    });
  });
});

describe('the hello extension of a content type', () => {
  const page = () => api.manablox.contentTypes.getByName('page');
  let seq = 0;
  const create = (fields: Record<string, unknown>) => {
    const slug = `greeted-${++seq}`;
    return api.content.create({ spaceId, typeId: page().id, title: slug, slug, fields });
  };

  it("adds its field to the config's type, after the type's own", () => {
    expect(page().fields.map((field) => field.name)).toEqual(['body', 'greeting']);
    expect(page().fields[1]).toMatchObject({
      type: 'string',
      settings: { max: 280 },
      admin: { zone: 'sidebar' },
    });
  });

  it('checks and stores the field like any other', async () => {
    const created = await create({ body: 'Text', greeting: 'Hello there' });
    expect(created.fields).toMatchObject({ body: 'Text', greeting: 'Hello there' });
    await expect(create({ greeting: 'x'.repeat(281) })).rejects.toMatchObject({
      key: 'content.validation.failed',
    });
  });

  it('keeps the field while the plugin is off: the type is the same in every space', async () => {
    await set(`space:${spaceId}`, { 'features.plugins.hello': { enabled: false } });
    const created = await create({ greeting: 'Still here' });
    expect(created.fields).toMatchObject({ greeting: 'Still here' });
  });

  it('refuses to boot with a type that is not declared in code', () => {
    expect(() =>
      resolveConfig({
        database: { url: db.url },
        auth: { secret: 'hello-platform-secret' },
        fieldTypes: builtinFieldTypes,
        plugins: [helloPlugin({ greetOn: ['ghost'] })],
      }),
    ).toThrow(expect.objectContaining({ key: 'plugin.extend.contentType.notFound' }));
  });
});

describe('the hello create step', () => {
  let seq = 0;
  const input = (plugins?: Record<string, unknown>) => {
    const name = `step-${++seq}`;
    return { name, machineName: name, url: 'https://step.test', ...(plugins ? { plugins } : {}) };
  };
  const spaceNamed = async (machineName: string) =>
    (await api.repos.spaces.list()).find((space) => space.machineName === machineName);
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error as { key: string; kind: string; details: unknown[] },
    );

  it('writes the first greeting in the space create', async () => {
    const space = await api.spaces.create(input({ hello: { greeting: ' Welcome ' } }), null);
    expect(await helloRepos(api.repos).greetings.list(space.id)).toEqual([
      expect.objectContaining({ message: 'Welcome' }),
    ]);
    const empty = await api.spaces.create(input({ hello: {} }), null);
    expect(await helloRepos(api.repos).greetings.countBySpace(empty.id)).toBe(0);
  });

  it('refuses an invalid draft before writing anything', async () => {
    const data = input({ hello: { greeting: 'x'.repeat(281) } });
    const error = await failure(api.spaces.create(data, null));
    expect(error).toMatchObject({
      key: 'space.validation.failed',
      details: [
        expect.objectContaining({
          key: 'space.plugin.invalid',
          path: ['plugins', 'hello', 'greeting'],
        }),
      ],
    });
    expect(await spaceNamed(data.machineName)).toBeUndefined();
  });

  it('refuses unknown plugins and plugins off for new spaces', async () => {
    expect(await failure(api.spaces.create(input({ nope: {} }), null))).toMatchObject({
      key: 'space.plugin.unknown',
    });
    await set('instance', { 'features.plugins.hello': { enabled: false } });
    const data = input({ hello: { greeting: 'Hi' } });
    expect(await failure(api.spaces.create(data, null))).toMatchObject({
      key: 'space.plugin.off',
      kind: 'forbidden',
    });
    expect(await spaceNamed(data.machineName)).toBeUndefined();
  });

  it('leaves no space behind when the step throws', async () => {
    await set('instance', { 'features.plugins.hello.shout': { enabled: false } });
    const data = input({ hello: { greeting: 'HELLO' } });
    expect(await failure(api.spaces.create(data, null))).toMatchObject({
      key: 'plugins.hello.shoutingOff',
    });
    expect(await spaceNamed(data.machineName)).toBeUndefined();
  });

  it('takes the data through the control API', async () => {
    const data = input({ hello: { greeting: 'Provisioned' } });
    const created = (await (await control('/spaces', 'POST', data)).json()) as { id: string };
    expect(await helloRepos(api.repos).greetings.list(created.id)).toEqual([
      expect.objectContaining({ message: 'Provisioned' }),
    ]);
    const refused = await app.request('/control/v1/spaces', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(input({ nope: {} })),
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: { key: 'space.plugin.unknown' } });
  });

  it('takes the drafts through spaces.create over rpc', async () => {
    const link = new RPCLink({
      url: 'http://hello.test/rpc',
      headers: { 'x-api-key': rootKey },
      fetch: async (request) => app.request(request),
    });
    const core = createORPCClient(link) as {
      spaces: { create(input: unknown): Promise<{ id: string }> };
    };
    const space = await core.spaces.create(input({ hello: { greeting: 'Over rpc' } }));
    expect(await helloRepos(api.repos).greetings.list(space.id)).toEqual([
      expect.objectContaining({ message: 'Over rpc' }),
    ]);
    expect(await refusal(core.spaces.create(input({ nope: 1 })))).toMatchObject({
      code: 'BAD_REQUEST',
      key: 'space.plugin.unknown',
    });
  });
});

describe('the hello mode', () => {
  it('serves its route and nothing of management', async () => {
    const runtime = await bootstrap({
      database: { url: db.url },
      auth: { secret: 'hello-platform-secret' },
      fieldTypes: builtinFieldTypes,
      plugins: [helloPlugin()],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { mode: 'hello', rateLimit: false },
    });
    try {
      expect(runtime.manablox.config.server.scopes).toEqual([]);
      const mode = await createApp(runtime);
      const home = await mode.request('/');
      expect(home.status).toBe(200);
      expect(await home.text()).toBe('Hello from the hello mode');
      expect((await mode.request('/rpc/spaces/list', { method: 'POST' })).status).toBe(404);
    } finally {
      await runtime.shutdown();
    }
  });
});
