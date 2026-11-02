import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_HOSTS_CACHE_TAG } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import {
  bootstrap,
  createApp,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '@manablox/server';
import type { DnsResolver } from '@manablox/services';
import { withControls } from '@manablox/services/testing';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type SiteRenderer, websitePlugin } from '../../src/index.js';
import { siteCacheTags } from '../../src/shared/site.js';
import { websiteOf } from '../helpers/runtime.js';

const KEY = 'domain-verification-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let site: Runtime;
let publicApi: Runtime;
let apiApp: Hono;
let siteApp: Hono;
let publicApp: Hono;
let designed: string;
let restore: (() => Promise<void>) | null = null;

const renderer: SiteRenderer = {
  renderPage: async (input) => ({
    html: `<!doctype html><title>${input.document?.title ?? 'Not found'}</title>`,
    status: input.status,
  }),
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
};

const txt = new Map<string, string>();
const resolver: DnsResolver = {
  resolveTxt: async (name) => {
    const value = txt.get(name);
    if (value === undefined) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return [[value]];
  },
  resolveCname: async (name) => (name === 'cname.site.test' ? ['edge.proxy.test.'] : []),
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

/** What another process sees at once through a shared cache and fresh controls. */
const syncProcesses = async () => {
  for (const runtime of [site, publicApi]) {
    runtime.controlStore.forget(null);
    await runtime.manablox.hooks.run(
      'cache:purge',
      { tags: [siteCacheTags.domains, API_HOSTS_CACHE_TAG] },
      { manablox: runtime.manablox, spaceId: null },
    );
  }
};

const requireVerification = async () => {
  restore = await withControls(api, { values: { 'domains.requireVerification': true } });
  await syncProcesses();
};

const domainCheck = (domain: string) =>
  siteApp.request(new Request(`http://any.test/_manablox/domain-check?domain=${domain}`));

const _publicGet = (host: string, path = '/') =>
  publicApp.request(new Request(`http://${host}${path}`));

beforeAll(async () => {
  db = await createTestDatabase('site_domain_verification', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-domain-verification-'));
  const config = {
    plugins: [websitePlugin({ renderer })],
    database: { url: db.url },
    auth: { secret: 'domain-verification-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [{ name: 'page', fields: [] }],
    logLevel: 'silent' as const,
    cache: { enabled: true, ttl: 300 },
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  };
  api = requireManagement(
    await bootstrap({
      ...config,
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'graphql', 'control'] },
      control: { apiKey: KEY, domainCnameTarget: 'edge.proxy.test' },
    }),
  );
  api.hostVerifier.resolver = resolver;
  site = await bootstrap({ ...config, server: { mode: 'website', rateLimit: false } });
  publicApi = await bootstrap({ ...config, server: { mode: 'public', rateLimit: false } });
  apiApp = await createApp(api);
  siteApp = await createApp(site);
  publicApp = await createApp(publicApi);

  const space = await api.repos.spaces.create({
    name: 'Designed',
    machineName: 'designed',
    url: 'http://unused.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  designed = space.id;
  await websiteOf(api).settings.set(designed, { mode: 'designed' });
  const about = await api.content.create({
    spaceId: designed,
    typeId: api.manablox.contentTypes.getByName('page').id,
    title: 'About',
    slug: 'about',
    fields: {},
  });
  await api.content.publish(designed, about.id);
}, 60_000);

afterEach(async () => {
  await restore?.();
  restore = null;
  txt.clear();
  await syncProcesses();
});

afterAll(async () => {
  await publicApi?.shutdown();
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('site domains', () => {
  it('serves a new domain at once while verification is off', async () => {
    const domain = await websiteOf(api).domains.create(designed, { hostname: 'open.site.test' });
    expect(domain.verification.status).toBe('verified');
    expect((await domainCheck('open.site.test')).status).toBe(200);
    expect((await siteApp.request(new Request('http://open.site.test/about'))).status).toBe(200);
  });

  it('keeps an unverified domain dark until its TXT record matches', async () => {
    await requireVerification();
    const domain = await websiteOf(api).domains.create(designed, { hostname: 'txt.site.test' });
    expect(domain.verification).toMatchObject({
      status: 'pending',
      txtName: '_manablox.txt.site.test',
      cnameTarget: 'edge.proxy.test',
    });

    const check = await domainCheck('txt.site.test');
    expect(check.status).toBe(404);
    expect(await check.text()).toBe('unknown');
    expect((await siteApp.request(new Request('http://txt.site.test/about'))).status).toBe(404);

    txt.set('_manablox.txt.site.test', domain.verification.txtValue as string);
    const events = await api.repos.controlEvents.latestSeq();
    expect((await websiteOf(api).domains.verify(designed, domain.id)).verification.status).toBe(
      'verified',
    );
    const emitted = await api.repos.controlEvents.listAfter(events, 10);
    expect(emitted.map((event) => [event.type, event.payload.hostname])).toEqual([
      ['domain.verified', 'txt.site.test'],
    ]);

    await syncProcesses();
    expect(await (await domainCheck('txt.site.test')).text()).toBe('ok');
    expect((await siteApp.request(new Request('http://txt.site.test/about'))).status).toBe(200);
  });

  it('verifies by CNAME in the periodic sweep', async () => {
    await requireVerification();
    const domain = await websiteOf(api).domains.create(designed, { hostname: 'cname.site.test' });
    const report = await api.hostVerifier.sweep();
    expect(report.verified).toBeGreaterThanOrEqual(1);
    expect((await websiteOf(api).domains.get(designed, domain.id)).verification.status).toBe(
      'verified',
    );
    await syncProcesses();
    expect((await domainCheck('cname.site.test')).status).toBe(200);
  });
});
