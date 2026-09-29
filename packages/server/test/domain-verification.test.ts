import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_HOSTS_CACHE_TAG } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { DnsResolver } from '@manablox/services';
import { withControls } from '@manablox/services/testing';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  bootstrap,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '../src/bootstrap.js';

const KEY = 'domain-verification-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let publicApi: Runtime;
let apiApp: Hono;
let publicApp: Hono;
let designed: string;
let restore: (() => Promise<void>) | null = null;

const txt = new Map<string, string>();
const resolver: DnsResolver = {
  resolveTxt: async (name) => {
    const value = txt.get(name);
    if (value === undefined) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return [[value]];
  },
  resolveCname: async (name) => (name === 'cname.site.test' ? ['edge.proxy.test.'] : []),
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

/** What another process sees at once through a shared cache and fresh controls. */
const syncProcesses = async () => {
  publicApi.controlStore.forget(null);
  await publicApi.manablox.hooks.run(
    'cache:purge',
    { tags: [API_HOSTS_CACHE_TAG] },
    { manablox: publicApi.manablox, spaceId: null },
  );
};

const requireVerification = async () => {
  restore = await withControls(api, { values: { 'domains.requireVerification': true } });
  await syncProcesses();
};

const publicGet = (host: string, path = '/') =>
  publicApp.request(new Request(`http://${host}${path}`));

beforeAll(async () => {
  db = await createTestDatabase('server_domain_verification');
  dir = await mkdtemp(join(tmpdir(), 'manablox-domain-verification-'));
  const config = {
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
  publicApi = await bootstrap({ ...config, server: { mode: 'public', rateLimit: false } });
  apiApp = await createApp(api);
  publicApp = await createApp(publicApi);

  const space = await api.repos.spaces.create({
    name: 'Designed',
    machineName: 'designed',
    url: 'http://unused.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  designed = space.id;
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
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('API hosts', () => {
  it('provisions a space with API hosts and serves it by host on an unpinned public API', async () => {
    const created = await control('/spaces', {
      method: 'POST',
      body: { name: 'Shop', machineName: 'shop', apiHosts: ['API.Shop.test'] },
    });
    expect(created.status).toBe(201);
    const shop = await json(created);
    expect(shop.apiHosts).toEqual([
      expect.objectContaining({ hostname: 'api.shop.test', verified: true }),
    ]);

    const replaced = await json(
      await control(`/spaces/${shop.id}/api-hosts`, {
        method: 'PUT',
        body: { hostnames: ['api.shop.test', 'cdn-origin.shop.test'] },
      }),
    );
    expect(replaced.apiHosts.map((host: { hostname: string }) => host.hostname)).toEqual([
      'api.shop.test',
      'cdn-origin.shop.test',
    ]);
    const listed = await json(await control('/spaces'));
    const entry = listed.items.find((space: { id: string }) => space.id === shop.id);
    expect(entry.apiHosts).toHaveLength(2);
    expect(entry.hosts).toEqual([]);

    const taken = await control('/spaces', {
      method: 'POST',
      body: { name: 'Copy', machineName: 'copy', apiHosts: ['api.shop.test'] },
    });
    expect(taken.status).toBe(422);
    expect(await api.repos.spaces.findByMachineName('copy')).toBeNull();

    await syncProcesses();
    const served = await publicGet('api.shop.test:443');
    expect(served.status).toBe(200);
    expect((await json(served)).space).toBe(shop.id);
    expect((await publicGet('cdn-origin.shop.test', '/v1/content')).status).toBe(200);
    const unknown = await publicGet('nobody.test', '/v1/content');
    expect(unknown.status).toBe(404);
    expect((await json(unknown)).error.key).toBe('publicApi.host.unknown');
    expect((await publicGet('127.0.0.1:3100', '/readyz')).status).toBe(200);

    const usage = await json(
      await control('/usage/external', {
        method: 'POST',
        body: {
          idempotencyKey: 'api-host-usage',
          host: 'api.shop.test',
          metric: 'bandwidthBytes',
          period: '2026-07',
          value: 10,
          mode: 'add',
        },
      }),
    );
    expect(usage).toMatchObject({ spaceId: shop.id, external: 10 });
  });

  it('does not serve an unverified API host while verification is required', async () => {
    await requireVerification();
    const host = await api.apiHosts.create(designed, 'api.designed.test');
    expect(host.verification.status).toBe('pending');
    await syncProcesses();
    expect((await publicGet('api.designed.test')).status).toBe(404);

    txt.set('_manablox.api.designed.test', host.verification.txtValue as string);
    await api.apiHosts.verify(designed, host.id);
    await syncProcesses();
    const served = await publicGet('api.designed.test');
    expect(served.status).toBe(200);
    expect((await json(served)).space).toBe(designed);
  });
});
