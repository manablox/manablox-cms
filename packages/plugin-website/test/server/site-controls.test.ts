import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FeatureKey } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import {
  bootstrap,
  createApp,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '@manablox/server';
import { withControls } from '@manablox/services/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SiteRenderer, websitePlugin } from '../../src/index.js';
import { websiteOf } from '../helpers/runtime.js';

const FORMS_SECRET = 'forms-secret-0123456789abcdef';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let site: Runtime;
let apiApp: Hono;
let siteApp: Hono;
let spaceA: string;
let spaceB: string;
let contactTypeId: string;

const renderer: SiteRenderer = {
  renderPage: async (input) => ({
    html: `<!doctype html><title>${input.document?.title ?? 'Not found'}</title>`,
    status: input.status,
  }),
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
};

const get = (url: string, headers: Record<string, string> = {}) =>
  siteApp.request(new Request(url, { headers }));

/** Switches features off; the site process forgets its cached controls at once. */
const off = async (features: Partial<Record<FeatureKey, boolean>>, spaceId?: string) => {
  const restore = await withControls(api, {
    ...(spaceId ? { scope: { kind: 'space', id: spaceId } } : {}),
    features,
  });
  site.controlStore.forget(null);
  return async () => {
    await restore();
    site.controlStore.forget(null);
  };
};

const designedSpace = async (name: string, hostname: string) => {
  const space = await api.repos.spaces.create({
    name,
    machineName: name,
    url: 'http://unused.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  await websiteOf(api).settings.set(space.id, { mode: 'designed' });
  await websiteOf(api).domains.create(space.id, { hostname });
  const typeId = api.manablox.contentTypes.getByName('page').id;
  const about = await api.content.create({
    spaceId: space.id,
    typeId,
    title: 'About',
    slug: 'about',
    fields: {},
  });
  await api.content.publish(space.id, about.id);
  await api.content.create({
    spaceId: space.id,
    typeId,
    title: 'Draft',
    slug: 'draft',
    fields: {},
  });
  return space.id;
};

beforeAll(async () => {
  db = await createTestDatabase('server_site_controls', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-site-controls-'));
  const config = {
    plugins: [websitePlugin({ renderer, forms: { secret: FORMS_SECRET } })],
    database: { url: db.url },
    auth: { secret: 'feature-controls-secret' },
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
      server: { rateLimit: false },
    }),
  );
  site = await bootstrap({ ...config, server: { mode: 'website', rateLimit: false } });
  apiApp = await createApp(api);
  siteApp = await createApp(site);
  contactTypeId = api.manablox.contentTypes.getByName('contact').id;
  spaceA = await designedSpace('a', 'a.test');
  spaceB = await designedSpace('b', 'b.test');
}, 60_000);

afterAll(async () => {
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('plugins.website', () => {
  it('off at the instance: every site answers the neutral 404; back on, it serves again', async () => {
    expect((await get('http://a.test/about')).status).toBe(200);
    const restore = await off({ 'plugins.website': false });
    try {
      const response = await get('http://a.test/about');
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('About');
      expect((await get('http://b.test/about')).status).toBe(404);
    } finally {
      await restore();
    }
    expect((await get('http://a.test/about')).status).toBe(200);
  });

  it('off in one space leaves the other sites up', async () => {
    const restore = await off({ 'plugins.website': false }, spaceA);
    try {
      expect((await get('http://a.test/about')).status).toBe(404);
      expect((await get('http://b.test/about')).status).toBe(200);
    } finally {
      await restore();
    }
  });
});

describe('plugins.website.shareLinks', () => {
  it('existing links and cookies stop working while off', async () => {
    const { token } = await websiteOf(api).designs.createShareLink(spaceA, {});
    const landing = await get(`http://a.test/_manablox/share/${token}`);
    expect(landing.status).toBe(302);
    const cookie = {
      cookie: (landing.headers.get('set-cookie') as string).split(';')[0] as string,
    };
    expect((await get('http://a.test/draft', cookie)).status).toBe(200);

    const restore = await off({ 'plugins.website.shareLinks': false }, spaceA);
    try {
      expect((await get(`http://a.test/_manablox/share/${token}`)).status).toBe(404);
      expect((await get('http://a.test/draft', cookie)).status).toBe(404);
      await expect(websiteOf(api).designs.createShareLink(spaceA, {})).rejects.toMatchObject({
        key: 'control.feature',
        status: 403,
      });
      // Another space keeps its links.
      const other = await websiteOf(api).designs.createShareLink(spaceB, {});
      expect((await get(`http://b.test/_manablox/share/${other.token}`)).status).toBe(302);
    } finally {
      await restore();
    }
    expect((await get('http://a.test/draft', cookie)).status).toBe(200);
  });
});

describe('plugins.website.forms', () => {
  const submit = (spaceId: string) =>
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
          databagTypeId: contactTypeId,
          values: { name: 'Ada' },
          locale: 'en',
          page: '/about',
          origin: 'a.test',
          form: 'page:x:contact',
        }),
      }),
    );

  it('the site answers form posts with the neutral 404 and the API refuses them', async () => {
    const post = () =>
      siteApp.request(
        new Request('http://a.test/_manablox/forms/page/x/contact', {
          method: 'POST',
          body: 'a=1',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        }),
      );
    // No forms config on the site process: forms answer 503 while on.
    expect((await post()).status).toBe(503);
    expect((await submit(spaceA)).status).toBe(201);

    const restore = await off({ 'plugins.website.forms': false }, spaceA);
    try {
      expect((await post()).status).toBe(404);
      const refused = await submit(spaceA);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { key: 'control.feature' } });
      expect((await submit(spaceB)).status).toBe(201);
    } finally {
      await restore();
    }
  });
});

describe('plugins.website.renders', () => {
  it('refuses renders past the space budget with the neutral 429; cached pages still serve', async () => {
    const spaceC = await designedSpace('c', 'c.test');
    const restore = await withControls(api, {
      scope: { kind: 'space', id: spaceC },
      values: { 'rateLimits.plugins.website.renders': { max: 1, windowSeconds: 60 } },
    });
    site.controlStore.forget(null);
    try {
      const first = await get('http://c.test/about');
      expect(first.status).toBe(200);
      const refused = await get('http://c.test/nowhere');
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
      expect(await refused.text()).toContain('Too many requests');
      // A cache hit renders nothing.
      expect((await get('http://c.test/about')).status).toBe(200);
      // Another space keeps its own budget.
      expect((await get('http://b.test/nowhere-else')).status).toBe(404);
    } finally {
      await restore();
      site.controlStore.forget(null);
    }
  });
});
