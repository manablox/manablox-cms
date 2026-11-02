import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedScope } from '@manablox/core';
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

const KEY = 'environment-requests-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let pub: Runtime;
let site: Runtime;
let apiApp: Hono;
let _pubApp: Hono;
let siteApp: Hono;
let superKey: string;
let _productionKey: string;
let spaceId: string;
let production: ResolvedScope;
let staging: ResolvedScope;
let articleId: string;
let stagingArticleId: string;
let _promoId: string;
let productionDoc: { id: string };
let stagingDoc: Record<string, any>;

const renderer: SiteRenderer = {
  renderPage: async (input) => ({
    html: `<!doctype html><title>${input.document?.title ?? 'Not found'}</title>`,
    status: input.status,
  }),
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
};

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const control = (path: string, body: unknown) =>
  apiApp.request(`/control/v1${path}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Sets space controls and drops every process's cached ones. */
async function setControls(body: Record<string, unknown>) {
  expect((await control(`/settings?scope=space:${spaceId}`, body)).status).toBeLessThan(300);
  for (const runtime of [api, pub, site]) runtime.controlStore.forget(null);
}

/** A management procedure over REST, as the superadmin key unless another is given. */
const rest = (
  path: string,
  body: Record<string, unknown>,
  options: { key?: string; environment?: string | undefined } = {},
) =>
  apiApp.request(`/api/v1/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.key ?? superKey,
      ...(options.environment ? { 'x-manablox-environment': options.environment } : {}),
    },
    body: JSON.stringify(body),
  });

const _graphql = (query: string, headers: Record<string, string>, app = apiApp, host?: string) =>
  app.request(
    new Request(`http://${host ?? 'api.test'}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query }),
    }),
  );

const onHost = (app: Hono, host: string, path: string, headers: Record<string, string> = {}) =>
  app.request(new Request(`http://${host}${path}`, { headers }));

beforeAll(async () => {
  db = await createTestDatabase('site_environment_requests', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-environments-'));
  const config = {
    plugins: [websitePlugin({ renderer })],
    database: { url: db.url },
    auth: { secret: 'environment-requests-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
    logLevel: 'silent' as const,
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
    cache: { enabled: true, ttl: 300 },
  };
  api = requireManagement(
    await bootstrap({
      ...config,
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'graphql', 'control'] },
      control: { apiKey: KEY },
    }),
  );
  apiApp = await createApp(api);

  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@environments.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  superKey = (await api.apiKeys.issue(admin.id, 'all')).key;

  const space = await api.repos.spaces.create({
    name: 'Env',
    machineName: 'env',
    url: 'https://env.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  spaceId = space.id;
  production = await api.environments.scope(spaceId);
  const row = await api.repos.environments.create({
    spaceId,
    machineName: 'staging',
    name: 'Staging',
    kind: 'staging',
  });
  staging = await api.environments.scope(spaceId, row.machineName);
  _productionKey = (
    await api.apiKeys.issue(admin.id, 'production only', {
      environmentIds: [production.environmentId],
    })
  ).key;

  const fields = [{ name: 'summary', type: 'string' }];
  articleId = (await api.contentTypes.create({ name: 'article', spaceId, fields })).id;
  // The same name in staging is a type of its own; one type only staging has.
  const created = await json(
    await rest(
      'contentTypes/create',
      { spaceId, name: 'article', fields },
      { environment: 'staging' },
    ),
  );
  stagingArticleId = created.id;
  _promoId = (
    await json(
      await rest(
        'contentTypes/create',
        { spaceId, environment: 'staging', name: 'promo', fields },
        {},
      ),
    )
  ).id;

  productionDoc = await api.content.create({
    spaceId,
    typeId: articleId,
    title: 'Live news',
    slug: 'live-news',
    fields: { summary: 'production' },
  });
  await api.content.publish(spaceId, productionDoc.id);
  stagingDoc = await json(
    await rest('content/create', {
      spaceId,
      environment: 'staging',
      typeId: stagingArticleId,
      title: 'Draft news',
      slug: 'draft-news',
      fields: { summary: 'staging' },
    }),
  );
  await rest('content/publish', { spaceId, environment: 'staging', id: stagingDoc.id });

  await api.apiHosts.create(production, 'api.env.test');
  await api.apiHosts.create(staging, 'api.staging.env.test');
  await websiteOf(api).settings.set(spaceId, { mode: 'designed' });
  await websiteOf(api).domains.create(production, { hostname: 'env.test' });
  await websiteOf(api).domains.create(staging, { hostname: 'staging.env.test' });
  await api.spaces.setHome(production, productionDoc.id);
  await api.spaces.setHome(staging, stagingDoc.id);

  pub = await bootstrap({ ...config, server: { mode: 'public', rateLimit: false } });
  _pubApp = await createApp(pub);
  site = await bootstrap({ ...config, server: { mode: 'website', rateLimit: false } });
  siteApp = await createApp(site);
}, 90_000);

afterAll(async () => {
  await site?.shutdown();
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the site', () => {
  it("renders a domain's environment, staging never indexed", async () => {
    const staged = await onHost(siteApp, 'staging.env.test', '/');
    expect(staged.status).toBe(200);
    expect(await staged.text()).toContain('<title>Draft news</title>');
    expect(staged.headers.get('x-robots-tag')).toContain('noindex');

    const live = await onHost(siteApp, 'env.test', '/');
    expect(await live.text()).toContain('<title>Live news</title>');
    expect(live.headers.get('x-robots-tag')).toBeNull();

    const robots = await (await onHost(siteApp, 'staging.env.test', '/robots.txt')).text();
    expect(robots).toContain('Disallow: /');
    expect((await onHost(siteApp, 'staging.env.test', '/sitemap.xml')).status).toBe(404);
    expect((await onHost(siteApp, 'env.test', '/draft-news')).status).toBe(404);
  });

  it('hides a staging domain while the feature is off', async () => {
    await setControls({ features: { environments: { enabled: false } } });
    try {
      expect((await onHost(siteApp, 'staging.env.test', '/')).status).toBe(404);
    } finally {
      await setControls({ features: { environments: { enabled: true } } });
    }
  });

  it('opens a share link only on its environment', async () => {
    const { token } = await websiteOf(api).designs.createShareLink(staging, {});
    const on = await onHost(siteApp, 'staging.env.test', `/_manablox/share/${token}`);
    expect(on.status).toBe(302);
    const off = await onHost(siteApp, 'env.test', `/_manablox/share/${token}`);
    expect(off.status).toBe(404);
  });
});
