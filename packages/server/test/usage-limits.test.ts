import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type UsageMetric, usagePeriod } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  bootstrap,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '../src/bootstrap.js';

const KEY = 'usage-limits-key-0123456789';
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

const counter = (space: string, metric: string) => ({
  scope: { kind: 'space' as const, id: space },
  metric,
  period: usagePeriod(new Date()).label,
});

/** Every process evaluates again and drops its cached controls. */
const settle = async () => {
  for (const runtime of [api, pub]) {
    runtime.controlStore.forget(null);
    await runtime.controlStore.usageState?.evaluate();
  }
};

/** Uses up `metric` at `scope` (the space by default) with a hard limit of 1; returns an undo. */
async function usedUp(metric: UsageMetric, scope = `space:${spaceId}`) {
  const key = counter(spaceId, metric);
  const before = await api.repos.usageCounters.get(key);
  await api.repos.usageCounters.set(key, Math.max(before, 1));
  const set = await control(`/settings?scope=${scope}`, {
    method: 'PATCH',
    body: { usage: { [metric]: { max: 1, mode: 'hard' } } },
  });
  expect(set.status).toBe(200);
  await settle();
  return async () => {
    await control(`/settings/usage.${metric}?scope=${scope}`, { method: 'DELETE' });
    await api.repos.usageCounters.set(key, before);
    await settle();
  };
}

const graphql = (space: string, app = apiApp) =>
  app.request('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-manablox-space': space },
    body: JSON.stringify({ query: '{ __typename }' }),
  });

const expectUsageRefusal = async (response: Response, metric: UsageMetric) => {
  expect(response.status).toBe(429);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  const body = await json(response);
  const error = body.error ?? body.errors?.[0]?.extensions;
  expect(error).toMatchObject({
    key: 'control.usage',
    details: [{ params: { metric, used: 1, max: 1 } }],
  });
};

beforeAll(async () => {
  db = await createTestDatabase('server_usage_limits');
  dir = await mkdtemp(join(tmpdir(), 'manablox-usage-limits-'));
  const config = {
    database: { url: db.url },
    auth: { secret: 'usage-limits-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [
      { name: 'page', fields: [{ name: 'hero', type: 'asset' }] },
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
    email: 'admin@limits.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  apiKey = (await api.apiKeys.issue(admin.id, 'limits')).key;
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
  spaceId = await create('limited');
  otherId = await create('other');

  const form = new FormData();
  form.set('file', new File([PNG], 'dot.png', { type: 'image/png' }));
  const upload = await apiApp.request(`/upload/${spaceId}`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
  });
  assetId = ((await upload.json()) as { id: string }).id;
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

afterAll(async () => {
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('apiRequests used up', () => {
  it('answers delivery with 429 no-store, purges once and counts the refusals as nothing', async () => {
    const purged: string[][] = [];
    const off = api.manablox.hooks.on('cache:purge', ({ tags }) => {
      purged.push(tags);
    });
    const served: unknown[] = [];
    const offServed = pub.manablox.hooks.on('request:served', (payload) => {
      served.push(payload);
    });
    const undo = await usedUp('apiRequests');
    try {
      expect(purged.filter((tags) => tags.includes(`space:${spaceId}`))).toHaveLength(1);
      await expectUsageRefusal(await graphql(spaceId), 'apiRequests');
      await expectUsageRefusal(await graphql(spaceId, pubApp), 'apiRequests');
      await expectUsageRefusal(await pubApp.request('/v1/content'), 'apiRequests');
      // Another space still answers.
      expect((await graphql(otherId)).status).toBe(200);
      await settle();
      expect(purged.filter((tags) => tags.includes(`space:${spaceId}`))).toHaveLength(1);
      expect(served).toEqual([]);
    } finally {
      await undo();
      off();
      offServed();
    }
    expect((await pubApp.request('/v1/content')).status).toBe(200);
  });

  it('reports the level in GET /state and follows an instance limit', async () => {
    const undo = await usedUp('apiRequests', 'instance');
    try {
      const state = await json(await control('/state'));
      expect(state.usage).toMatchObject({
        instance: { apiRequests: { level: 'blocked', used: 1, max: 1 } },
      });
      // The instance limit blocks every space.
      await expectUsageRefusal(await graphql(otherId), 'apiRequests');
    } finally {
      await undo();
    }
    expect((await json(await control('/state'))).usage).toEqual({});
  });

  it('is reached through an external report at once', async () => {
    const set = await control(`/settings?scope=space:${otherId}`, {
      method: 'PATCH',
      body: { usage: { bandwidthBytes: { max: 100, mode: 'hard' } } },
    });
    expect(set.status).toBe(200);
    try {
      const report = await control('/usage/external', {
        method: 'POST',
        body: {
          idempotencyKey: 'limits-cdn-1',
          spaceId: otherId,
          metric: 'bandwidthBytes',
          period: usagePeriod(new Date()).label,
          value: 100,
          mode: 'add',
        },
      });
      expect(report.status).toBe(200);
      const state = await json(await control('/state'));
      expect(state.usage[`space:${otherId}`]).toMatchObject({
        bandwidthBytes: { level: 'blocked', used: 100, max: 100 },
      });
    } finally {
      await control(`/settings/usage.bandwidthBytes?scope=space:${otherId}`, { method: 'DELETE' });
      await settle();
    }
  });
});

describe('other metrics used up', () => {
  it('refuses uploads', async () => {
    const undo = await usedUp('uploads');
    try {
      const form = new FormData();
      form.set('file', new File([PNG], 'dot.png', { type: 'image/png' }));
      const response = await apiApp.request(`/upload/${spaceId}`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form,
      });
      expect(response.status).toBe(429);
      expect(await json(response)).toMatchObject({ error: { key: 'control.usage' } });
    } finally {
      await undo();
    }
  });
});

describe('the group spaces limit', () => {
  it('refuses spaces joining a full group with 409, and nothing changes', async () => {
    const group = await json(await control('/groups', { method: 'POST', body: { name: 'Two' } }));
    const limit = (mode: 'hard' | 'soft') =>
      control(`/settings?scope=group:${group.id}`, {
        method: 'PATCH',
        body: { limits: { spaces: { max: 1, mode } } },
      });
    expect((await limit('hard')).status).toBe(200);

    const one = await control(`/groups/${group.id}/spaces`, {
      method: 'PUT',
      body: { spaceIds: [spaceId] },
    });
    expect(one.status).toBe(200);
    const two = await control(`/groups/${group.id}/spaces`, {
      method: 'PUT',
      body: { spaceIds: [spaceId, otherId] },
    });
    expect(two.status).toBe(409);
    expect(await json(two)).toMatchObject({
      error: {
        key: 'control.limit',
        details: [{ params: { limit: 'spaces', scope: `group:${group.id}`, used: 1, max: 1 } }],
      },
    });
    // Swapping keeps the count, so it passes.
    const swap = await control(`/groups/${group.id}/spaces`, {
      method: 'PUT',
      body: { spaceIds: [otherId] },
    });
    expect((await json(swap)).spaceIds).toEqual([otherId]);

    const spacesBefore = (await api.repos.spaces.list()).length;
    const provisioned = await control('/spaces', {
      method: 'POST',
      body: { name: 'Third', machineName: 'third', group: group.id },
    });
    expect(provisioned.status).toBe(409);
    expect(await api.repos.spaces.list()).toHaveLength(spacesBefore);

    expect((await limit('soft')).status).toBe(200);
    const soft = await control('/spaces', {
      method: 'POST',
      body: { name: 'Third', machineName: 'third', group: group.id },
    });
    expect(soft.status).toBe(201);
    expect((await json(soft)).group).toMatchObject({ id: group.id });
    await control(`/groups/${group.id}`, { method: 'DELETE' });
  });
});
