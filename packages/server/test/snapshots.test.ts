import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'snapshots-control-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Hono;
let superKey: string;
let editorKey: string;
let counter = 0;

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const control = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

/** A space provisioned through the control API, with one asset whose bytes are stored. */
async function freshSpace() {
  const machineName = `snap-${++counter}`;
  const response = await control('/spaces', {
    method: 'POST',
    body: { name: machineName, machineName },
  });
  expect(response.status).toBe(201);
  const space = await json(response);
  const key = `${space.id}/2026/09/file-${counter}.txt`;
  await api.storage.put(key, Buffer.from('kept bytes'), { contentType: 'text/plain' });
  const asset = await api.repos.assets.create({
    spaceId: space.id,
    driver: 'local',
    key,
    filename: 'file.txt',
    name: 'File',
    mimeType: 'text/plain',
    size: 10,
  });
  return { spaceId: space.id as string, machineName, assetId: asset.id, key };
}

const setControls = async (scope: string, body: Record<string, unknown>) => {
  expect((await control(`/settings?scope=${scope}`, { method: 'PATCH', body })).status).toBe(200);
  api.controlStore.forget(null);
};

beforeAll(async () => {
  db = await createTestDatabase('server_snapshots');
  dir = await mkdtemp(join(tmpdir(), 'manablox-snapshots-'));
  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'snapshots-secret' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
      control: { apiKey: KEY },
    }),
  );
  app = await createApp(api);
  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@snapshots.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  superKey = (await api.apiKeys.issue(admin.id, 'snapshots')).key;
  const editor = await api.repos.users.create({
    name: 'Editor',
    email: 'editor@snapshots.test',
    role: 'editor',
    passwordHash: 'x',
  });
  editorKey = (await api.apiKeys.issue(editor.id, 'snapshots')).key;
}, 60_000);

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('snapshot endpoints of the control API', () => {
  it('takes, lists and restores a snapshot into a new space', async () => {
    const { spaceId, machineName } = await freshSpace();

    const created = await control('/snapshots', { method: 'POST', body: { spaceId } });
    expect(created.status).toBe(201);
    const snapshot = await json(created);
    expect(snapshot).toMatchObject({ spaceId, machineName, trigger: 'manual' });
    expect(snapshot).not.toHaveProperty('manabloxSnapshot');
    const files = await readdir(join(dir, 'files', 'snapshots', spaceId));
    expect(files.sort()).toEqual([`${snapshot.id}.json.gz`, `${snapshot.id}.manifest.json`]);

    const listed = await json(await control(`/snapshots?spaceId=${spaceId}`));
    expect(listed.items.map((item: { id: string }) => item.id)).toEqual([snapshot.id]);

    const restored = await control('/snapshots/restore', {
      method: 'POST',
      body: { spaceId, snapshot: snapshot.id, mode: 'new' },
    });
    expect(restored.status).toBe(200);
    const result = await json(restored);
    expect(result).toMatchObject({ mode: 'new', sourceSpaceId: spaceId, replacedDeleted: false });
    expect(await api.repos.spaces.findById(result.spaceId)).not.toBeNull();
    expect(result).not.toHaveProperty('import');
  });

  it('answers 403 while the feature is off and 404 for an unknown snapshot', async () => {
    const { spaceId } = await freshSpace();
    await setControls(`space:${spaceId}`, { features: { snapshots: { enabled: false } } });
    const refused = await control('/snapshots', { method: 'POST', body: { spaceId } });
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.key).toBe('control.feature');
    await setControls(`space:${spaceId}`, { features: { snapshots: { enabled: true } } });

    const missing = await control('/snapshots/restore', {
      method: 'POST',
      body: { spaceId, snapshot: '2020-01-01T00-00-00-000Z', mode: 'new' },
    });
    expect(missing.status).toBe(404);
  });
});

describe('snapshot downloads', () => {
  it('stream the export to a superadmin and refuse anyone else', async () => {
    const { spaceId, machineName } = await freshSpace();
    const snapshot = await api.snapshots.create(spaceId);
    const path = `/transfer/snapshots/${spaceId}/${snapshot.id}`;

    const response = await app.request(path, { headers: { 'x-api-key': superKey } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain(
      `${machineName}-${snapshot.id}.manablox.json`,
    );
    const payload = await json(response);
    expect(payload.space).toMatchObject({ id: spaceId, machineName });

    const editor = await app.request(path, { headers: { 'x-api-key': editorKey } });
    expect(editor.status).toBe(403);
  });
});

describe('deleted asset files', () => {
  it('are deleted at once while the space takes no snapshots', async () => {
    const { spaceId, assetId, key } = await freshSpace();
    await api.media.delete(spaceId, assetId);
    expect(await exists(join(dir, 'files', key))).toBe(false);
  });

  it('are kept under a tombstone while the space takes snapshots', async () => {
    const { spaceId, assetId, key } = await freshSpace();
    await setControls(`space:${spaceId}`, { snapshots: { interval: 'daily' } });
    await api.media.delete(spaceId, assetId);
    expect(await api.repos.assets.findById(assetId)).toBeNull();
    expect(await exists(join(dir, 'files', key))).toBe(true);
    const day = new Date().toISOString().slice(0, 10);
    expect(await exists(join(dir, 'files', 'trash', day, `${assetId}.json`))).toBe(true);
  });
});
