import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrap, type ManagementRuntime, requireManagement } from '../src/bootstrap.js';

const KEY = 'control-usage-key-0123456789';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let apiApp: Hono;
let spaceId: string;
let apiKey: string;

/** The calendar month; the anchor day is the default. */
const period = () => new Date().toISOString().slice(0, 7);

const counted = (metric: string) =>
  api.repos.usageCounters.get({ scope: { kind: 'space', id: spaceId }, metric, period: period() });

const flush = async () => {
  await api.controlStore.usage?.flush();
};

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

beforeAll(async () => {
  db = await createTestDatabase('server_control_usage');
  dir = await mkdtemp(join(tmpdir(), 'manablox-control-usage-'));
  const config = {
    database: { url: db.url },
    auth: { secret: 'control-usage-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      { name: 'page', fields: [] },
      { name: 'contact', kind: 'data' as const, fields: [{ name: 'name', type: 'string' }] },
    ],
    logLevel: 'silent' as const,
    cache: { enabled: true, ttl: 300 },
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  };
  api = requireManagement(
    await bootstrap({
      ...config,
      server: {
        rateLimit: false,
        scopes: ['rpc', 'auth', 'uploads', 'media', 'graphql', 'control'],
      },
      control: { apiKey: KEY },
    }),
  );
  apiApp = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@usage.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  const space = await api.repos.spaces.create({
    name: 'Usage',
    machineName: 'usage',
    url: 'https://front.usage.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
  await api.apiHosts.create(spaceId, 'site.usage.test');
  const about = await api.content.create({
    spaceId,
    typeId: api.manablox.contentTypes.getByName('page').id,
    title: 'About',
    slug: 'about',
    fields: {},
  });
  await api.content.publish(spaceId, about.id);
  apiKey = (await api.apiKeys.issue(admin.id, 'usage')).key;
}, 60_000);

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('metering', () => {
  it('counts delivery GraphQL with bytes, API-key reads without, and uploads', async () => {
    const before = {
      requests: await counted('apiRequests'),
      bytes: await counted('bandwidthBytes'),
    };
    const delivery = await apiApp.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-manablox-space': spaceId },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    expect(delivery.status).toBe(200);
    const deliveryBytes = (await delivery.arrayBuffer()).byteLength;

    const read = await apiApp.request('/api/v1/tags/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ spaceId }),
    });
    expect(read.status).toBe(200);
    await read.arrayBuffer();

    const form = new FormData();
    form.set('file', new File([PNG], 'dot.png', { type: 'image/png' }));
    const upload = await apiApp.request(`/upload/${spaceId}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form,
    });
    expect(upload.status).toBe(201);

    await vi.waitFor(async () => {
      await flush();
      expect(await counted('apiRequests')).toBe(before.requests + 2);
    });
    expect(await counted('bandwidthBytes')).toBe(before.bytes + deliveryBytes);
    expect(await counted('uploads')).toBe(1);
  });

  it('attributes admin media to the owning space and spaceless requests apart', async () => {
    const space = (name: string) =>
      api.repos.spaces.create({ name, machineName: name, url: `https://${name}.test` });
    const [owner, next] = [await space('media-owner'), await space('media-next')];
    const bytesIn = (id: string) =>
      api.repos.usageCounters.get({
        scope: { kind: 'space', id },
        metric: 'bandwidthBytes',
        period: period(),
      });
    const unattributed = () =>
      api.repos.usageCounters.get({
        scope: { kind: 'instance' },
        metric: 'apiRequests',
        period: period(),
      });
    const before = await unattributed();
    const asset = await api.media.upload({
      spaceId: owner.id,
      filename: 'owned.png',
      mimeType: 'image/png',
      body: PNG,
    });
    const load = async () => {
      const response = await apiApp.request(`/media/${asset.id}/original`);
      expect(response.status).toBe(200);
      return (await response.arrayBuffer()).byteLength;
    };

    const size = await load();
    await vi.waitFor(async () => {
      await flush();
      expect(await bytesIn(owner.id)).toBe(size);
    });

    // Served from the cache after the first lookup.
    const lookup = vi.spyOn(api.repos.assets, 'ownerSpaceId');
    await load();
    await vi.waitFor(async () => {
      await flush();
      expect(await bytesIn(owner.id)).toBe(2 * size);
    });
    expect(lookup).not.toHaveBeenCalled();

    await api.media.setSpaces(owner.id, asset.id, [next.id]);
    await load();
    await vi.waitFor(async () => {
      await flush();
      expect(await bytesIn(next.id)).toBe(size);
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    lookup.mockRestore();

    const spaceless = await apiApp.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    });
    await spaceless.arrayBuffer();
    await vi.waitFor(async () => {
      await flush();
      expect(await unattributed()).toBe(before + 1);
    });
    const report = await json(await control('/usage?scope=instance'));
    expect(report.unattributed.apiRequests).toBe(before + 1);
    expect(report.metrics.apiRequests.counted).toBeGreaterThan(0);
    const spaceReport = await json(await control(`/usage?scope=space:${owner.id}`));
    expect(spaceReport.unattributed).toBeNull();
  });
});

describe('usage endpoints', () => {
  it('stores external figures once per key, by space id or host', async () => {
    const body = {
      idempotencyKey: 'cdn-2026-07-a',
      spaceId,
      metric: 'bandwidthBytes',
      period: '2026-07',
      value: 5000,
      mode: 'set',
    };
    const first = await control('/usage/external', { method: 'POST', body });
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({
      spaceId,
      metric: 'bandwidthBytes',
      period: '2026-07',
      mode: 'set',
      value: 5000,
      duplicate: false,
      external: 5000,
    });
    const again = await json(await control('/usage/external', { method: 'POST', body }));
    expect(again).toMatchObject({ duplicate: true, external: 5000 });
    const changed = await control('/usage/external', {
      method: 'POST',
      body: { ...body, value: 1 },
    });
    expect(changed.status).toBe(409);

    const { spaceId: _id, ...rest } = body;
    const byHost = await json(
      await control('/usage/external', {
        method: 'POST',
        body: {
          ...rest,
          idempotencyKey: 'cdn-2026-07-b',
          host: 'SITE.usage.test',
          mode: 'add',
          value: 25,
        },
      }),
    );
    expect(byHost).toMatchObject({ spaceId, external: 5025 });
    const byFrontend = await json(
      await control('/usage/external', {
        method: 'POST',
        body: {
          ...rest,
          idempotencyKey: 'cdn-2026-07-c',
          host: 'front.usage.test',
          mode: 'add',
          value: 5,
        },
      }),
    );
    expect(byFrontend).toMatchObject({ spaceId, external: 5030 });

    const both = await control('/usage/external', {
      method: 'POST',
      body: { ...body, idempotencyKey: 'x', host: 'site.usage.test' },
    });
    expect(both.status).toBe(422);
    const wrongMetric = await control('/usage/external', {
      method: 'POST',
      body: { ...body, idempotencyKey: 'y', metric: 'mails' },
    });
    expect(wrongMetric.status).toBe(422);
    const unknownHost = await control('/usage/external', {
      method: 'POST',
      body: { ...rest, idempotencyKey: 'z', host: 'nobody.test' },
    });
    expect(unknownHost.status).toBe(404);
  });

  it('answers counted, external and total usage with the limit of the scope', async () => {
    await api.repos.usageCounters.increment(
      { scope: { kind: 'space', id: spaceId }, metric: 'bandwidthBytes', period: '2026-07' },
      1000,
    );
    const set = await control(`/settings?scope=space:${spaceId}`, {
      method: 'PATCH',
      body: { usage: { bandwidthBytes: { max: 7000, mode: 'soft' } } },
    });
    expect(set.status).toBe(200);

    const response = await control(`/usage?scope=space:${spaceId}&period=2026-07`);
    expect(response.status).toBe(200);
    const report = await json(response);
    expect(report).toMatchObject({
      scope: `space:${spaceId}`,
      period: '2026-07',
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    });
    expect(report.metrics.bandwidthBytes).toEqual({
      counted: 1000,
      external: 5030,
      total: 6030,
      limit: { max: 7000, mode: 'soft', thresholds: [80, 100] },
      state: 'warn',
    });
    expect(report.metrics.mails).toEqual({
      counted: 0,
      external: 0,
      total: 0,
      limit: null,
      state: null,
    });

    const current = await json(await control('/usage?scope=instance'));
    expect(current.period).toBe(period());
    expect((await control('/usage?scope=instance&period=2026-7')).status).toBe(422);
    expect((await control('/usage?scope=nope')).status).toBe(400);
  });

  it('describes both endpoints in the OpenAPI document', async () => {
    const document = await json(
      await apiApp.request('/control/openapi.json', {
        headers: { authorization: `Bearer ${KEY}` },
      }),
    );
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/usage', '/usage/external']),
    );
  });

  it('audits an external figure with the control actor', async () => {
    expect(
      await api.repos.audit.count({ spaceId, actions: ['usage.external'], actorKind: 'control' }),
    ).toBe(3);
  });
});
