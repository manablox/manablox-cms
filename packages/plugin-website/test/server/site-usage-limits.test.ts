import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AnyUsageMetric, usagePeriod } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import {
  bootstrap,
  createApp,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '@manablox/server';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SiteRenderer, websitePlugin } from '../../src/index.js';
import { websiteOf } from '../helpers/runtime.js';

const KEY = 'usage-limits-key-0123456789';
const FORMS_SECRET = 'forms-secret-0123456789abcdef';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let site: Runtime;
let pub: Runtime;
let apiApp: Hono;
let siteApp: Hono;
let pubApp: Hono;
let spaceId: string;
let _otherId: string;
let assetId: string;
let apiKey: string;

const renderer: SiteRenderer = {
  renderPage: async (input) => ({
    html: `<!doctype html><title>${input.document?.title ?? 'Not found'}</title>`,
    status: input.status,
  }),
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
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

const counter = (space: string, metric: string) => ({
  scope: { kind: 'space' as const, id: space },
  metric,
  period: usagePeriod(new Date()).label,
});

/** Every process evaluates again and drops its cached controls. */
const settle = async () => {
  for (const runtime of [api, site, pub]) {
    runtime.controlStore.forget(null);
    await runtime.controlStore.usageState?.evaluate();
  }
};

/** Uses up `metric` at `scope` (the space by default) with a hard limit of 1; returns an undo. */
async function usedUp(metric: AnyUsageMetric, scope = `space:${spaceId}`) {
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

const _graphql = (space: string, app = apiApp) =>
  app.request('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-manablox-space': space },
    body: JSON.stringify({ query: '{ __typename }' }),
  });

const expectUsageRefusal = async (response: Response, metric: AnyUsageMetric) => {
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
  db = await createTestDatabase('site_usage_limits', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-usage-limits-'));
  const config = {
    plugins: [websitePlugin({ renderer, forms: { secret: FORMS_SECRET } })],
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
  site = await bootstrap({ ...config, server: { mode: 'website', rateLimit: false } });
  apiApp = await createApp(api);
  siteApp = await createApp(site);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@limits.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  apiKey = (await api.apiKeys.issue(admin.id, 'limits')).key;
  const create = async (name: string, hostname: string) => {
    const space = await api.repos.spaces.create({
      name,
      machineName: name,
      url: `https://${name}.front.test`,
      defaultLocale: 'en',
      locales: ['en'],
    });
    await websiteOf(api).settings.set(space.id, { mode: 'designed' });
    await websiteOf(api).domains.create(space.id, { hostname });
    return space.id;
  };
  spaceId = await create('limited', 'limited.test');
  _otherId = await create('other', 'other.test');

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
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('bandwidthBytes used up', () => {
  it('shows the neutral 503 on the site and refuses media and delivery', async () => {
    expect((await siteApp.request(new Request('http://limited.test/about'))).status).toBe(200);
    const undo = await usedUp('bandwidthBytes');
    try {
      const page = await siteApp.request(new Request('http://limited.test/about'));
      expect(page.status).toBe(503);
      expect(page.headers.get('cache-control')).toBe('private, no-store');
      expect(page.headers.get('retry-after')).toBeTruthy();
      const html = await page.text();
      expect(html).toContain('Temporarily unavailable');
      expect(html).not.toContain('About');
      // Hosting checks still answer; the other site is up.
      const check = await siteApp.request(
        new Request('http://limited.test/_manablox/domain-check?domain=limited.test'),
      );
      expect(check.status).toBe(200);
      expect((await siteApp.request(new Request('http://other.test/'))).status).not.toBe(503);

      await expectUsageRefusal(
        await pubApp.request(`/media/${assetId}/original`),
        'bandwidthBytes',
      );
      await expectUsageRefusal(await pubApp.request('/v1/content'), 'bandwidthBytes');
    } finally {
      await undo();
    }
    expect((await siteApp.request(new Request('http://limited.test/about'))).status).toBe(200);
    expect((await pubApp.request(`/media/${assetId}/original`)).status).toBe(200);
  });
});

describe('other metrics used up', () => {
  it('refuses forwarded form submissions', async () => {
    const undo = await usedUp('plugins.website.formSubmissions');
    try {
      const response = await apiApp.request(
        new Request('http://api.test/plugins/website/forms/submit', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${FORMS_SECRET}`,
            'x-manablox-space': spaceId,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            spaceId,
            databagTypeId: api.manablox.contentTypes.getByName('contact').id,
            values: { name: 'Ada' },
            locale: 'en',
            page: '/about',
            origin: 'limited.test',
            form: 'page:x:contact',
          }),
        }),
      );
      expect(response.status).toBe(429);
      expect(await json(response)).toMatchObject({ error: { key: 'control.usage' } });
    } finally {
      await undo();
    }
  });
});
