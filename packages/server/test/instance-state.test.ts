import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  bootstrap,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '../src/bootstrap.js';

const KEY = 'instance-state-key-0123456789';
const ADMIN = 'https://admin.state.test';
const PASSWORD = 'state-password-123';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let pub: Runtime;
let apiApp: Hono;
let pubApp: Hono;
let spaceId: string;
let otherId: string;
let assetId: string;
let apiKey: string;
let editorEmail: string;

const control = (path: string, init: { method?: string; body?: unknown } = {}) =>
  apiApp.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const json = async (response: Response) => (await response.json()) as Record<string, any>;

/** Every process drops its cached controls. */
const settle = () => {
  for (const runtime of [api, pub]) runtime.controlStore.forget(null);
};

async function setState(scope: string, state: { status: string; message?: string } | null) {
  const response =
    state === null
      ? await control(`/settings/state?scope=${scope}`, { method: 'DELETE' })
      : scope === 'instance'
        ? await control('/instance/state', { method: 'PUT', body: state })
        : await control(`/settings?scope=${scope}`, { method: 'PATCH', body: { state } });
  expect(response.status).toBeLessThan(300);
  settle();
}

const rest = (path: string, body: unknown) =>
  apiApp.request(`/api/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });

const upload = (space: string) => {
  const form = new FormData();
  form.set('file', new File([PNG], 'dot.png', { type: 'image/png' }));
  return apiApp.request(`/upload/${space}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
  });
};

const graphql = (app: Hono, space: string) =>
  app.request('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-manablox-space': space },
    body: JSON.stringify({ query: '{ __typename }' }),
  });

const signIn = () =>
  apiApp.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ADMIN },
    body: JSON.stringify({ email: editorEmail, password: PASSWORD }),
  });

const expectRefusal = async (response: Response, key: string, params?: object) => {
  expect(response.status).toBe(423);
  const body = await json(response);
  expect(body.error).toMatchObject({ key, ...(params ? { details: [{ params }] } : {}) });
};

const expectNeutral = async (response: Response) => {
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const text = await response.text();
  expect(text).not.toContain('billing');
  return text;
};

beforeAll(async () => {
  db = await createTestDatabase('server_instance_state');
  dir = await mkdtemp(join(tmpdir(), 'manablox-instance-state-'));
  const config = {
    database: { url: db.url },
    auth: { secret: 'instance-state-secret', trustedOrigins: [ADMIN] },
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      { name: 'page', fields: [{ name: 'hero', type: 'asset' }] },
      { name: 'contact', kind: 'data' as const, fields: [{ name: 'name', type: 'string' }] },
    ],
    logLevel: 'silent' as const,
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  };
  api = requireManagement(
    await bootstrap({
      ...config,
      server: {
        adminUrl: ADMIN,
        rateLimit: false,
        scopes: ['rpc', 'auth', 'uploads', 'media', 'graphql', 'control'],
      },
      control: { apiKey: KEY },
    }),
  );
  apiApp = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@state.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  apiKey = (await api.apiKeys.issue(admin.id, 'state')).key;
  editorEmail = (
    await api.users.create({
      name: 'Editor',
      email: 'editor@state.test',
      password: PASSWORD,
      role: 'editor',
    })
  ).email;
  const create = async (name: string) => {
    const space = await api.repos.spaces.create({
      name,
      machineName: name,
      url: `https://${name}.front.test`,
      defaultLocale: 'en',
      locales: ['en'],
    });
    return space.id;
  };
  spaceId = await create('stated');
  otherId = await create('other');

  assetId = ((await (await upload(spaceId)).json()) as { id: string }).id;
  const about = await api.content.create({
    spaceId,
    typeId: api.manablox.contentTypes.getByName('page').id,
    title: 'About',
    slug: 'about',
    fields: { hero: assetId },
  });
  await api.content.publish(spaceId, about.id);

  pub = await bootstrap({
    ...config,
    server: { mode: 'public', rateLimit: false },
    publicApi: { spaceId },
  });
  pubApp = await createApp(pub);
}, 60_000);

afterEach(async () => {
  for (const scope of ['instance', `space:${spaceId}`, `space:${otherId}`]) {
    await setState(scope, null);
  }
});

afterAll(async () => {
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('a read-only instance', () => {
  it('refuses every write with 423 and keeps reads, delivery and sign-in', async () => {
    await setState('instance', { status: 'readOnly', message: 'Invoice due' });
    const refused = { scope: 'instance', reason: 'Invoice due' };

    await expectRefusal(
      await rest('tags/create', { spaceId, name: 'New' }),
      'control.readOnly',
      refused,
    );
    await expectRefusal(
      await rest('users/create', { name: 'N', email: 'n@state.test', password: PASSWORD }),
      'control.readOnly',
    );
    await expectRefusal(await upload(spaceId), 'control.readOnly', refused);
    await expectRefusal(
      await apiApp.request('/transfer/import', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: '{}',
      }),
      'control.readOnly',
    );

    expect((await rest('tags/list', { spaceId })).status).toBe(200);
    expect((await graphql(apiApp, spaceId)).status).toBe(200);
    expect((await pubApp.request('/v1/content')).status).toBe(200);
    expect((await pubApp.request(`/media/${assetId}/original`)).status).toBe(200);
    expect((await signIn()).status).toBe(200);
    expect((await control('/state')).status).toBe(200);

    await setState('instance', { status: 'active' });
    expect((await rest('tags/create', { spaceId, name: 'Again' })).status).toBe(200);
  });
});

describe('a read-only space or group', () => {
  it('refuses writes in that space only', async () => {
    await setState(`space:${spaceId}`, { status: 'readOnly' });
    await expectRefusal(await rest('tags/create', { spaceId, name: 'S' }), 'control.readOnly', {
      scope: `space:${spaceId}`,
      reason: null,
    });
    await expectRefusal(await upload(spaceId), 'control.readOnly');
    expect((await rest('tags/list', { spaceId })).status).toBe(200);
    expect((await rest('tags/create', { spaceId: otherId, name: 'S' })).status).toBe(200);
    expect((await upload(otherId)).status).toBe(201);
  });

  it('follows the group a space belongs to', async () => {
    const group = await json(await control('/groups', { method: 'POST', body: { name: 'RO' } }));
    await control(`/groups/${group.id}/spaces`, { method: 'PUT', body: { spaceIds: [otherId] } });
    try {
      await setState(`group:${group.id}`, { status: 'readOnly', message: 'Downgraded' });
      await expectRefusal(
        await rest('tags/create', { spaceId: otherId, name: 'G' }),
        'control.readOnly',
        { scope: `group:${group.id}`, reason: 'Downgraded' },
      );
      expect((await rest('tags/create', { spaceId, name: 'G' })).status).toBe(200);
    } finally {
      await control(`/groups/${group.id}`, { method: 'DELETE' });
      settle();
    }
  });
});

describe('a suspended instance', () => {
  it('answers only the account read in RPC, a neutral 503 for content, and keeps control and sign-in', async () => {
    await setState('instance', { status: 'suspended', message: 'Suspended for billing' });

    await expectRefusal(await rest('tags/list', { spaceId }), 'control.suspended', {
      reason: 'Suspended for billing',
    });
    const me = await rest('users/me', {});
    expect(me.status).toBe(200);
    expect((await json(me)).controls.state).toEqual({
      status: 'suspended',
      message: 'Suspended for billing',
    });
    expect((await rest('users/setupNeeded', {})).status).toBe(200);
    expect((await signIn()).status).toBe(200);

    await expectRefusal(await upload(spaceId), 'control.suspended');
    await expectRefusal(
      await apiApp.request(`/transfer/${spaceId}/export`, { headers: { 'x-api-key': apiKey } }),
      'control.suspended',
    );

    for (const response of [
      await pubApp.request('/v1/content'),
      await pubApp.request(`/media/${assetId}/original`),
      await graphql(pubApp, spaceId),
      await graphql(apiApp, spaceId),
    ]) {
      expect(await expectNeutral(response)).toContain('service.unavailable');
    }
    expect((await pubApp.request('/healthz')).status).toBe(200);

    // The control API lifts it.
    expect((await control('/state')).status).toBe(200);
    await setState('instance', { status: 'active' });
    expect((await pubApp.request('/v1/content')).status).toBe(200);
    expect((await rest('tags/list', { spaceId })).status).toBe(200);
  });

  it('cannot be set on a space', async () => {
    const response = await control(`/settings?scope=space:${spaceId}`, {
      method: 'PATCH',
      body: { state: { status: 'suspended' } },
    });
    expect(response.status).toBe(422);
  });
});
