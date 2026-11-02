import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { databaseContextOf } from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { bootstrap, createApp, type ManagementRuntime, requireManagement } from '@manablox/server';
import { pruneRetention, type SpaceExport } from '@manablox/services';
import { withControls } from '@manablox/services/testing';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiRepos, aiTables } from '../src/server/db/index.js';
import { aiPlugin } from '../src/server/plugin.js';
import type { AiServices } from '../src/server/services/index.js';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Hono;
let apiKey: string;
let adminId: string;
let spaceId: string;
let fake: Server;
let seq = 0;

/** A solid RGB PNG, 64 x 20. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(64, 0);
  header.writeUInt32BE(20, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(64 * 3, 0x30)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 20 }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ai = (): AiServices => api.manablox.plugin<AiServices>('ai').services;

/** A procedure of the management API, as the admin's API key. */
const rpc = async (path: string, body: unknown) => {
  const response = await app.request(`/rpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ json: body }),
  });
  const payload = (await response.json()) as { json: Record<string, any> };
  return { status: response.status, body: payload.json };
};

const freshSpace = async () => {
  const name = `ai-${++seq}`;
  const space = await api.repos.spaces.create({
    name,
    machineName: name,
    url: `https://${name}.test`,
    defaultLocale: 'en',
    locales: ['en'],
  });
  return space.id;
};

beforeAll(async () => {
  const plugin = aiPlugin();
  db = await createTestDatabase('ai_server', { plugins: [plugin] });
  dir = await mkdtemp(join(tmpdir(), 'manablox-ai-'));

  // An OpenAI-style image endpoint on the private network, allowed by the plugin's options.
  const image = png();
  fake = createServer((request, response) => {
    request.resume();
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const fakeHost = `127.0.0.1:${(fake.address() as AddressInfo).port}`;

  api = requireManagement(
    await bootstrap({
      database: { url: db.url },
      auth: { secret: 'ai-plugin-secret-0123456789abcdef' },
      fieldTypes: builtinFieldTypes,
      contentTypes: [],
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') }, maxFileSize: 10_000_000 },
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'uploads', 'media'] },
      plugins: [aiPlugin({ allowedHosts: [fakeHost] })],
    }),
  );
  app = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@ai.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  adminId = admin.id;
  apiKey = (await api.apiKeys.issue(admin.id, 'ai')).key;
  spaceId = await freshSpace();
  await ai().ai.saveProvider(spaceId, {
    kind: 'custom',
    slug: 'local',
    label: 'Local',
    enabled: true,
    apiKey: 'sk-local-key',
    models: { image: 'fake-image' },
    config: { baseUrl: `http://${fakeHost}/v1`, api: 'openai', capabilities: ['image'] },
  });
}, 60_000);

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  await new Promise((resolve) => fake?.close(resolve));
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the AI plugin on a booted instance', () => {
  it('answers under plugins.ai, and refuses while it is locked in the space', async () => {
    const listed = await rpc('plugins/ai/providers', { spaceId });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ ref: 'custom:local', hasKey: true, apiKeyHint: '-key' }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain('sk-local-key');

    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceId },
      features: { 'plugins.ai': false },
    });
    try {
      expect((await rpc('plugins/ai/providers', { spaceId })).status).toBe(403);
    } finally {
      await restore();
    }
  });

  it('fails an image generation past the upload rules, as a job of the plugin', async () => {
    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceId },
      values: { 'uploads.maxFileSize': 10 },
    });
    try {
      const generation = await ai().ai.startMedia({
        spaceId,
        capability: 'image',
        prompt: 'a green square',
      });
      expect(generation).toMatchObject({
        status: 'failed',
        error: 'asset.tooLarge',
        assetId: null,
      });
    } finally {
      await restore();
    }
    const stored = await ai().ai.startMedia({
      spaceId,
      capability: 'image',
      prompt: 'a green square',
    });
    expect(stored).toMatchObject({ status: 'succeeded' });
  });

  it('refuses images while plugins.ai.images is off', async () => {
    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceId },
      features: { 'plugins.ai.images': false },
    });
    try {
      await expect(
        ai().ai.startMedia({ spaceId, capability: 'image', prompt: 'a cat' }),
      ).rejects.toMatchObject({ key: 'control.feature' });
    } finally {
      await restore();
    }
  });

  it('exports providers without keys under plugins, and imports them switched off', async () => {
    const payload = await api.spaces.export(spaceId);
    expect(payload.sections).toContain('ai.providers');
    expect(payload.plugins?.['ai.providers']).toEqual([
      expect.objectContaining({ kind: 'custom', slug: 'local', label: 'Local' }),
    ]);
    expect(JSON.stringify(payload)).not.toContain('sk-local-key');

    const [provider] = payload.plugins?.['ai.providers'] as Array<Record<string, unknown>>;
    const copy = {
      ...payload,
      space: { ...payload.space, id: crypto.randomUUID(), machineName: 'ai-copy-import' },
      plugins: { ...payload.plugins, 'ai.providers': [{ ...provider, id: crypto.randomUUID() }] },
    } as SpaceExport;
    const result = await api.spaces.import(copy, adminId);
    expect(result.plugins).toMatchObject({ 'ai.providers': 1 });
    expect(await aiRepos(api.repos).listProvidersBySpace(result.spaceId)).toEqual([
      expect.objectContaining({ slug: 'local', enabled: false, apiKey: null }),
    ]);
  });

  it('carries the keys over when a snapshot is restored on the same instance', async () => {
    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceId },
      features: { snapshots: true },
    });
    try {
      const manifest = await api.snapshots.create(spaceId);
      const result = await api.snapshots.restore(spaceId, manifest.id, { mode: 'new' });
      const [copy] = await aiRepos(api.repos).listProvidersBySpace(result.spaceId);
      const [source] = await aiRepos(api.repos).listProvidersBySpace(spaceId);
      expect(copy?.id).not.toBe(source?.id);
      expect(copy).toMatchObject({ enabled: true, apiKey: source?.apiKey, apiKeyHint: '-key' });
    } finally {
      await restore();
    }
  });

  it('copies the providers of another space into a new one', async () => {
    const created = await rpc('spaces/create', {
      name: 'ai-copy',
      machineName: 'ai-copy',
      url: 'https://ai-copy.test',
      plugins: { ai: { copyFrom: spaceId } },
    });
    expect(created.status).toBe(200);
    expect(created.body.warnings).toEqual([]);
    const [copy] = await aiRepos(api.repos).listProvidersBySpace(created.body.id as string);
    expect(copy).toMatchObject({ slug: 'local', enabled: true, apiKeyHint: '-key' });
  });

  it('prunes finished generations past plugins.ai.generationsDays', async () => {
    const space = await freshSpace();
    const store = aiRepos(api.repos);
    const old = await store.createGeneration({
      spaceId: space,
      providerId: null,
      providerKind: 'openai',
      kind: 'text',
      status: 'succeeded',
      model: 'm',
      prompt: 'p',
    });
    const { aiGenerations } = aiTables(databaseContextOf(api.repos));
    await databaseContextOf(api.repos)
      .db.update(aiGenerations)
      .set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) })
      .where(eq(aiGenerations.id, old.id));
    const restore = await withControls(api, {
      scope: { kind: 'space', id: space },
      values: { 'retention.plugins.ai.generationsDays': 1 },
    });
    try {
      const report = await pruneRetention(api.manablox, api.repos, { budgetMs: 10_000 });
      expect(report['plugins.ai.generationsDays']).toBe(1);
      expect(await store.findGenerationById(old.id)).toBeNull();
    } finally {
      await restore();
    }
  });
});
