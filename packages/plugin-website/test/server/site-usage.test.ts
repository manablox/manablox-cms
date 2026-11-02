import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type SiteRenderer, websitePlugin } from '../../src/index.js';
import { websiteOf } from '../helpers/runtime.js';

const KEY = 'control-usage-key-0123456789';
const FORMS_SECRET = 'forms-secret-0123456789abcdef';
const _PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let site: Runtime;
let apiApp: Hono;
let siteApp: Hono;
let spaceId: string;
let _apiKey: string;

const renderer: SiteRenderer = {
  renderPage: async (input) => ({
    html: `<!doctype html><title>${input.document?.title ?? 'Not found'}</title>`,
    status: input.status,
  }),
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
};

/** The calendar month; the anchor day is the default. */
const period = () => new Date().toISOString().slice(0, 7);

const counted = (metric: string) =>
  api.repos.usageCounters.get({ scope: { kind: 'space', id: spaceId }, metric, period: period() });

const flush = async () => {
  await api.controlStore.usage?.flush();
  await site.controlStore.usage?.flush();
};

const _control = (path: string, init: { method?: string; body?: unknown } = {}) =>
  apiApp.request(`/control/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const _json = async (response: Response) => (await response.json()) as Record<string, any>;

beforeAll(async () => {
  db = await createTestDatabase('site_control_usage', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-control-usage-'));
  const config = {
    plugins: [websitePlugin({ renderer, forms: { secret: FORMS_SECRET } })],
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
  site = await bootstrap({
    ...config,
    server: { mode: 'website', rateLimit: false },
    control: { usageLog: true },
  });
  apiApp = await createApp(api);
  siteApp = await createApp(site);

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
  await websiteOf(api).settings.set(spaceId, { mode: 'designed' });
  await websiteOf(api).domains.create(spaceId, { hostname: 'site.usage.test' });
  const about = await api.content.create({
    spaceId,
    typeId: api.manablox.contentTypes.getByName('page').id,
    title: 'About',
    slug: 'about',
    fields: {},
  });
  await api.content.publish(spaceId, about.id);
  _apiKey = (await api.apiKeys.issue(admin.id, 'usage')).key;
}, 60_000);

afterAll(async () => {
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('metering', () => {
  it('counts site bytes, cache hits included, and logs each request', async () => {
    const info = vi.spyOn(site.manablox.logger, 'info').mockImplementation(() => {});
    try {
      const first = await siteApp.request(new Request('http://site.usage.test/about'));
      const second = await siteApp.request(new Request('http://site.usage.test/about'));
      const bytes =
        (await first.arrayBuffer()).byteLength + (await second.arrayBuffer()).byteLength;
      expect(first.status).toBe(200);

      await vi.waitFor(() =>
        expect(info.mock.calls.filter(([, message]) => message === 'request served')).toHaveLength(
          2,
        ),
      );
      const logged = info.mock.calls
        .filter(([, message]) => message === 'request served')
        .map(([fields]) => fields as Record<string, unknown>);
      expect(logged[0]).toMatchObject({
        surface: 'website',
        spaceId,
        path: '/about',
        cached: false,
      });
      expect(logged[1]).toMatchObject({ cached: true });

      await flush();
      expect(await counted('bandwidthBytes')).toBe(bytes);
      expect(await counted('apiRequests')).toBe(0);
    } finally {
      info.mockRestore();
    }
  });

  it('counts a stored form submission, not a refused one', async () => {
    const submit = (values: Record<string, unknown>) =>
      apiApp.request(
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
            values,
            locale: 'en',
            page: '/about',
            origin: 'site.usage.test',
            form: 'page:x:contact',
          }),
        }),
      );
    expect((await submit({ name: 'Ada' })).status).toBe(201);
    expect((await submit({ name: 42 })).status).toBe(422);
    await flush();
    expect(await counted('plugins.website.formSubmissions')).toBe(1);
  });
});
