import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';
import { allowedIpList } from '../src/control/auth.js';

const KEY = 'control-key-0123456789abcdef';
const NEXT = 'control-key-next-0123456789';

let db: TestDatabase;
let dir: string;
let runtime: ManagementRuntime;
let app: Hono;
let ipApp: Hono;
let plainApp: Hono;
let spaceId: string;
let adminId: string;
const others: ManagementRuntime[] = [];

const config = (overrides: Record<string, unknown> = {}) => ({
  database: { url: db.url },
  auth: { secret: 'control-auth-secret' },
  fieldTypes: builtinFieldTypes,
  logLevel: 'silent',
  storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  ...overrides,
});

const call = (
  path: string,
  init: {
    method?: string;
    body?: unknown;
    key?: string | null;
    headers?: Record<string, string>;
    target?: Hono;
  } = {},
) =>
  (init.target ?? app).request(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.key === null ? {} : { authorization: `Bearer ${init.key ?? KEY}` }),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const json = async (response: Response) => (await response.json()) as Record<string, any>;

beforeAll(async () => {
  db = await createTestDatabase('server_control');
  dir = await mkdtemp(join(tmpdir(), 'manablox-control-'));
  runtime = requireManagement(
    await bootstrap(
      config({
        server: { rateLimit: false, scopes: ['rpc', 'auth', 'graphql', 'control'] },
        control: { apiKey: KEY, nextApiKey: NEXT },
      }) as never,
    ),
  );
  app = await createApp(runtime);

  const ipRuntime = requireManagement(
    await bootstrap(
      config({
        server: { rateLimit: false, scopes: ['control'] },
        control: { apiKey: KEY, allowedIps: ['203.0.113.0/24', '2001:db8::1'] },
      }) as never,
    ),
  );
  others.push(ipRuntime);
  ipApp = await createApp(ipRuntime);

  const plain = requireManagement(
    await bootstrap(config({ server: { rateLimit: false }, control: { apiKey: KEY } }) as never),
  );
  others.push(plain);
  plainApp = await createApp(plain);

  const admin = await runtime.repos.users.create({
    name: 'Admin',
    email: 'admin@example.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  adminId = admin.id;
  spaceId = (
    await runtime.spaces.create(
      { name: 'Main', machineName: 'main', url: 'https://main.test' },
      adminId,
    )
  ).id;
});

afterAll(async () => {
  for (const other of others) await other.shutdown();
  await runtime?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('mounting', () => {
  it('refuses to start with the scope named and no key', async () => {
    await expect(
      bootstrap(config({ server: { scopes: ['control'] }, control: {} }) as never),
    ).rejects.toMatchObject({
      key: 'config.invalid',
      details: [expect.objectContaining({ key: 'config.control.keyMissing' })],
    });
  });

  it('is not mounted without the scope, even with a key', async () => {
    const response = await call('/control/v1/instance', { target: plainApp });
    expect(response.status).toBe(404);
  });

  it('refuses a malformed IP allowlist entry', () => {
    expect(() => allowedIpList(['10.0.0.0/33'])).toThrow();
    expect(() => allowedIpList(['nope'])).toThrow();
    expect(() => allowedIpList(['10.0.0.0/8', '::1', 'fd00::/8'])).not.toThrow();
  });
});

describe('auth', () => {
  it('needs the bearer key', async () => {
    const missing = await call('/control/v1/instance', { key: null });
    expect(missing.status).toBe(401);
    expect((await json(missing)).error.key).toBe('auth.unauthorized');
    expect((await call('/control/v1/instance', { key: 'wrong' })).status).toBe(401);
    expect((await call('/control/openapi.json', { key: null })).status).toBe(401);
  });

  it('accepts the current and the next key', async () => {
    expect((await call('/control/v1/instance')).status).toBe(200);
    expect((await call('/control/v1/instance', { key: NEXT })).status).toBe(200);
  });

  it('checks the client IP against the allowlist', async () => {
    const at = (ip: string | null, key = KEY) =>
      call('/control/v1/instance', {
        target: ipApp,
        key,
        headers: ip ? { 'x-forwarded-for': ip } : {},
      });
    expect((await at('203.0.113.9')).status).toBe(200);
    expect((await at('2001:db8::1')).status).toBe(200);
    const refused = await at('198.51.100.1');
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.key).toBe('control.ipNotAllowed');
    expect((await at(null)).status).toBe(403);
    expect((await at('203.0.113.9', 'wrong')).status).toBe(401);
  });
});

describe('instance and catalogue', () => {
  it('reports version, migrations and health', async () => {
    const body = await json(await call('/control/v1/instance'));
    expect(body).toMatchObject({
      version: expect.any(String),
      catalogueVersion: expect.any(String),
      health: { status: 'ok', database: 'ok' },
      migrations: { pending: 0 },
    });
    expect(body.migrations.applied).toBe(body.migrations.latest);
  });

  it('lists the catalogue', async () => {
    const body = await json(await call('/control/v1/catalogue'));
    const keys = body.controls.map((control: { key: string }) => control.key);
    expect(keys).toContain('features.sso');
    expect(keys).toContain('limits.spaces');
  });
});

describe('settings', () => {
  it('replaces a scope from the grouped body and audits it as the control API', async () => {
    const response = await call('/control/v1/settings?scope=instance', {
      method: 'PUT',
      body: {
        features: { sso: { enabled: false, presentation: 'locked' } },
        limits: { spaces: { max: 5, mode: 'hard' } },
        rateLimits: { 'uploads.parallel': { max: 5 } },
        retention: { versionsDays: 90 },
        snapshots: { interval: 'daily' },
        admin: { links: { upgrade: 'https://example.test/upgrade' } },
      },
    });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toEqual({
      scope: 'instance',
      settings: {
        'admin.links': { upgrade: 'https://example.test/upgrade' },
        'features.sso': { enabled: false, presentation: 'locked' },
        'limits.spaces': { max: 5, mode: 'hard' },
        'rateLimits.uploads.parallel': { max: 5 },
        'retention.versionsDays': 90,
        'snapshots.interval': 'daily',
      },
    });

    const audit = await runtime.repos.audit.page({ actions: ['control.replace'] });
    expect(audit.items[0]).toMatchObject({ actorKind: 'control', targetId: 'instance' });
  });

  it('leaves the scope unchanged when one key is invalid', async () => {
    const before = await json(await call('/control/v1/settings?scope=instance'));
    const response = await call('/control/v1/settings?scope=instance', {
      method: 'PUT',
      body: { 'features.sso': { enabled: true }, 'features.nope': { enabled: false } },
    });
    expect(response.status).toBe(422);
    expect((await json(response)).error.details[0]).toMatchObject({
      key: 'control.key.unknown',
      path: ['features.nope'],
    });
    expect(await json(await call('/control/v1/settings?scope=instance'))).toEqual(before);
  });

  it('merges a flat body with PATCH and removes a key with DELETE', async () => {
    const patched = await json(
      await call('/control/v1/settings?scope=instance', {
        method: 'PATCH',
        body: { 'features.approvals': { enabled: false } },
      }),
    );
    expect(Object.keys(patched.settings)).toEqual(
      expect.arrayContaining(['features.approvals', 'features.sso', 'limits.spaces']),
    );

    const removed = await json(
      await call('/control/v1/settings/features.approvals?scope=instance', { method: 'DELETE' }),
    );
    expect(removed).toEqual({ scope: 'instance', removed: true });
    const after = await json(await call('/control/v1/settings?scope=instance'));
    expect(after.settings['features.approvals']).toBeUndefined();
  });

  it('stores a null value and resolves it as keep', async () => {
    const response = await call('/control/v1/settings?scope=instance', {
      method: 'PATCH',
      body: { 'retention.versionsDays': null },
    });
    expect(response.status).toBe(200);
    const after = await json(await call('/control/v1/settings?scope=instance'));
    expect(after.settings['retention.versionsDays']).toBeNull();
    expect((await runtime.manablox.controls.resolved(null)).retention.versionsDays).toBeNull();
    await call('/control/v1/settings/retention.versionsDays?scope=instance', { method: 'DELETE' });
  });

  it('refuses a key given flat and grouped', async () => {
    const response = await call('/control/v1/settings?scope=instance', {
      method: 'PATCH',
      body: { 'features.sso': { enabled: true }, features: { sso: { enabled: false } } },
    });
    expect(response.status).toBe(422);
    expect((await json(response)).error.details[0].key).toBe('control.key.duplicate');
  });

  it('answers bad scopes clearly', async () => {
    const invalid = await call('/control/v1/settings?scope=nowhere');
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error.key).toBe('control.scope.invalid');
    expect((await call('/control/v1/settings?scope=space:not-a-uuid')).status).toBe(404);
    const notAllowed = await call(`/control/v1/settings?scope=space:${spaceId}`, {
      method: 'PATCH',
      body: { 'features.sso': { enabled: false } },
    });
    expect(notAllowed.status).toBe(422);
  });

  it('lists every scope without a scope', async () => {
    const body = await json(await call('/control/v1/settings'));
    expect(body.scopes.instance['features.sso']).toBeDefined();
  });
});

describe('groups', () => {
  it('creates, addresses by external id, assigns spaces and deletes', async () => {
    const created = await call('/control/v1/groups', {
      method: 'POST',
      body: { name: 'Acme', externalId: 'acme' },
    });
    expect(created.status).toBe(201);
    const group = await json(created);
    expect(group).toMatchObject({ name: 'Acme', externalId: 'acme', spaceIds: [] });

    const renamed = await json(
      await call('/control/v1/groups/ext:acme', { method: 'PATCH', body: { name: 'Acme Inc' } }),
    );
    expect(renamed).toMatchObject({ id: group.id, name: 'Acme Inc' });

    const assigned = await json(
      await call('/control/v1/groups/ext:acme/spaces', {
        method: 'PUT',
        body: { spaceIds: [spaceId] },
      }),
    );
    expect(assigned.spaceIds).toEqual([spaceId]);

    const scoped = await json(
      await call('/control/v1/settings?scope=group:ext:acme', {
        method: 'PUT',
        body: { features: { menus: { enabled: false } } },
      }),
    );
    expect(scoped.scope).toBe(`group:${group.id}`);

    const space = await json(await call(`/control/v1/spaces/${spaceId}`));
    expect(space.group).toMatchObject({ id: group.id, externalId: 'acme' });

    const state = await json(await call('/control/v1/state'));
    const spaceState = state.scopes.find(
      (entry: { scope: string }) => entry.scope === `space:${spaceId}`,
    );
    expect(spaceState.group).toBe(`group:${group.id}`);
    expect(spaceState.featuresOff).toEqual(expect.arrayContaining(['sso', 'menus']));

    const audit = await runtime.repos.audit.page({ targetKind: 'spaceGroup' });
    expect(audit.items.every((entry) => entry.actorKind === 'control')).toBe(true);

    expect((await call('/control/v1/groups/ext:acme', { method: 'DELETE' })).status).toBe(200);
    expect((await call('/control/v1/groups/ext:acme')).status).toBe(404);
    expect((await json(await call(`/control/v1/spaces/${spaceId}`))).group).toBeNull();
  });

  it('replays a POST with the same idempotency key', async () => {
    const post = (body: unknown) =>
      call('/control/v1/groups', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': 'group-once' },
      });
    const first = await post({ name: 'Once', externalId: 'once' });
    expect(first.status).toBe(201);
    const second = await post({ name: 'Once', externalId: 'once' });
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    const groups = await json(await call('/control/v1/groups'));
    expect(
      groups.items.filter((item: { externalId: string }) => item.externalId === 'once'),
    ).toHaveLength(1);

    const reused = await post({ name: 'Other' });
    expect(reused.status).toBe(409);
    expect((await json(reused)).error.key).toBe('control.idempotency.mismatch');
  });
});

describe('spaces', () => {
  it('lists spaces with counts', async () => {
    const body = await json(await call('/control/v1/spaces'));
    const main = body.items.find((item: { id: string }) => item.id === spaceId);
    expect(main).toMatchObject({
      machineName: 'main',
      status: 'ready',
      hosts: [],
      counts: { members: 1 },
    });
  });

  it('provisions a space owned by the superadmins, audited as the control API', async () => {
    const response = await call('/control/v1/spaces', {
      method: 'POST',
      body: { name: 'Shop', machineName: 'shop', locales: ['en', 'de'], starter: 'basic' },
    });
    expect(response.status).toBe(201);
    const space = await json(response);
    expect(space).toMatchObject({
      machineName: 'shop',
      defaultLocale: 'en',
      locales: ['en', 'de'],
    });
    expect(space.counts.documents).toBeGreaterThan(0);
    expect(await runtime.repos.users.findSpaceRole(adminId, space.id)).toBe('owner');

    const audit = await runtime.repos.audit.page({ actions: ['space.create'], spaceId: space.id });
    expect(audit.items[0]).toMatchObject({ actorKind: 'control' });
  });

  it('refuses a taken machine name', async () => {
    const response = await call('/control/v1/spaces', {
      method: 'POST',
      body: { name: 'Again', machineName: 'shop' },
    });
    expect(response.status).toBe(422);
    expect((await json(response)).error.details[0].key).toBe('space.machineName.taken');
  });
});

describe('state', () => {
  it('stores the instance state and reports it', async () => {
    const set = await call('/control/v1/instance/state', {
      method: 'PUT',
      body: { status: 'readOnly', message: 'Maintenance' },
    });
    expect(await json(set)).toEqual({ status: 'readOnly', message: 'Maintenance' });
    const state = await json(await call('/control/v1/state'));
    expect(state.usage).toEqual({});
    expect(state.scopes[0]).toMatchObject({
      scope: 'instance',
      state: { status: 'readOnly', scope: 'instance', message: 'Maintenance' },
    });
    await call('/control/v1/instance/state', { method: 'PUT', body: { status: 'active' } });
  });
});

describe('openapi', () => {
  it('describes every route and the catalogue', async () => {
    const response = await call('/control/openapi.json');
    expect(response.status).toBe(200);
    const document = await json(response);
    expect(document.openapi).toMatch(/^3\.1/);
    expect(Object.keys(document.paths).sort()).toEqual(
      [
        '/catalogue',
        '/events',
        '/groups',
        '/groups/{id}',
        '/groups/{id}/spaces',
        '/instance',
        '/instance/state',
        '/settings',
        '/settings/{key}',
        '/snapshots',
        '/snapshots/restore',
        '/spaces',
        '/spaces/{id}',
        '/spaces/{id}/api-hosts',
        '/spaces/{id}/environments',
        '/spaces/{id}/environments/{environment}',
        '/spaces/{id}/environments/{environment}/diff',
        '/spaces/{id}/environments/{environment}/promote',
        '/state',
        '/usage',
        '/usage/external',
        '/users',
        '/users/owner',
        '/users/{id}/reset-link',
        '/users/{id}/revoke-sessions',
      ].sort(),
    );
    expect(document.components.schemas.ControlSettings.properties['features.sso']).toBeDefined();
    expect(document.paths['/settings'].put.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ControlSettingsInput',
    });
    expect(document.components.securitySchemes.controlKey.scheme).toBe('bearer');
  });

  it('answers unknown control routes with the JSON error body', async () => {
    const response = await call('/control/v1/nope');
    expect(response.status).toBe(404);
    expect((await json(response)).error.key).toBe('route.notFound');
  });
});
