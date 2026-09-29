import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'environments-control-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Hono;
let counter = 0;

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const control = (
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) =>
  app.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

async function freshSpace(): Promise<string> {
  const machineName = `env-${++counter}`;
  const response = await control('/spaces', {
    method: 'POST',
    body: { name: machineName, machineName },
  });
  expect(response.status).toBe(201);
  return (await json(response)).id as string;
}

beforeAll(async () => {
  db = await createTestDatabase('server_environments');
  dir = await mkdtemp(join(tmpdir(), 'manablox-environments-'));
  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'environments-secret' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
      control: { apiKey: KEY },
    }),
  );
  app = await createApp(api);
}, 60_000);

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('environment endpoints of the control API', () => {
  it('creates, lists, diffs, promotes and deletes', async () => {
    const spaceId = await freshSpace();
    await api.contentTypes.create({
      name: 'page',
      spaceId,
      fields: [{ name: 'summary', type: 'string' }],
    });

    const created = await control(`/spaces/${spaceId}/environments`, {
      method: 'POST',
      body: { machineName: 'staging', name: 'Staging', mode: 'config' },
      headers: { 'idempotency-key': `create-${spaceId}` },
    });
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.environment).toMatchObject({
      machineName: 'staging',
      kind: 'staging',
      createdMode: 'config',
    });
    expect(body.copied).toMatchObject({ contentTypes: 1 });

    // A repeat replays the first response.
    const replay = await control(`/spaces/${spaceId}/environments`, {
      method: 'POST',
      body: { machineName: 'staging', name: 'Staging', mode: 'config' },
      headers: { 'idempotency-key': `create-${spaceId}` },
    });
    expect(replay.status).toBe(201);
    expect((await json(replay)).environment.id).toBe(body.environment.id);

    const listed = await json(await control(`/spaces/${spaceId}/environments`));
    expect(listed.items.map((row: { machineName: string }) => row.machineName)).toEqual([
      'production',
      'staging',
    ]);

    const diff = await json(await control(`/spaces/${spaceId}/environments/staging/diff`));
    expect(diff).toMatchObject({ environment: 'staging', mode: 'config', breaking: false });

    const promoted = await control(`/spaces/${spaceId}/environments/staging/promote`, {
      method: 'POST',
      body: { mode: 'config' },
    });
    expect(promoted.status).toBe(200);
    expect(await json(promoted)).toMatchObject({ status: 'applied', mode: 'config' });

    const full = await control(`/spaces/${spaceId}/environments/staging/promote`, {
      method: 'POST',
      body: { mode: 'full' },
    });
    expect(full.status).toBe(409);
    expect((await json(full)).error.key).toBe('environment.promote.confirmRequired');

    const deleted = await control(`/spaces/${spaceId}/environments/staging`, {
      method: 'DELETE',
    });
    expect(await json(deleted)).toEqual({ deleted: true });

    const entries = await api.repos.audit.page({ spaceId }, undefined, { limit: 50, offset: 0 });
    const actions = entries.items.filter((entry) => entry.action.startsWith('environment.'));
    expect(actions.map((entry) => entry.action).sort()).toEqual([
      'environment.create',
      'environment.delete',
      'environment.promote',
    ]);
    expect(actions.every((entry) => entry.actorKind === 'control')).toBe(true);
  });

  it('answers 403 for production and 404 for unknown ones', async () => {
    const spaceId = await freshSpace();
    const production = await control(`/spaces/${spaceId}/environments/production`, {
      method: 'DELETE',
    });
    expect(production.status).toBe(403);
    expect((await json(production)).error.key).toBe('environment.production.undeletable');
    const missing = await control(`/spaces/${spaceId}/environments/nope/promote`, {
      method: 'POST',
      body: {},
    });
    expect(missing.status).toBe(404);
    const unknown = await control('/spaces/not-a-space/environments');
    expect(unknown.status).toBe(404);
  });

  it('is in the OpenAPI document', async () => {
    const document = await json(
      await app.request('/control/openapi.json', {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/spaces/{id}/environments',
        '/spaces/{id}/environments/{environment}',
        '/spaces/{id}/environments/{environment}/diff',
        '/spaces/{id}/environments/{environment}/promote',
      ]),
    );
  });
});
