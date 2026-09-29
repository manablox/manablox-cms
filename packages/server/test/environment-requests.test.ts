import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedScope } from '@manablox/core';
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

const KEY = 'environment-requests-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let pub: Runtime;
let apiApp: Hono;
let pubApp: Hono;
let superKey: string;
let productionKey: string;
let spaceId: string;
let production: ResolvedScope;
let staging: ResolvedScope;
let articleId: string;
let stagingArticleId: string;
let promoId: string;
let productionDoc: { id: string };
let stagingDoc: Record<string, any>;

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
  for (const runtime of [api, pub]) runtime.controlStore.forget(null);
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

const graphql = (query: string, headers: Record<string, string>, app = apiApp, host?: string) =>
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
  db = await createTestDatabase('server_environment_requests');
  dir = await mkdtemp(join(tmpdir(), 'manablox-environments-'));
  const config = {
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
  productionKey = (
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
  promoId = (
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
  await api.spaces.setHome(production, productionDoc.id);
  await api.spaces.setHome(staging, stagingDoc.id);

  pub = await bootstrap({ ...config, server: { mode: 'public', rateLimit: false } });
  pubApp = await createApp(pub);
}, 90_000);

afterAll(async () => {
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('the management API', () => {
  it('reads and writes the environment the input or header names', async () => {
    expect(stagingDoc).toMatchObject({ environmentId: staging.environmentId });
    const inStaging = await json(
      await rest('content/get', { spaceId, id: stagingDoc.id }, { environment: 'staging' }),
    );
    expect(inStaging).toMatchObject({ id: stagingDoc.id, title: 'Draft news' });

    const listed = await json(
      await rest('content/list', { filter: { spaceId, environment: 'staging' } }),
    );
    expect(listed.items.map((item: { id: string }) => item.id)).toEqual([stagingDoc.id]);
    const live = await json(await rest('content/list', { filter: { spaceId } }));
    expect(live.items.map((item: { id: string }) => item.id)).toEqual([productionDoc.id]);
  });

  it('refuses a document of another environment by id', async () => {
    expect(await json(await rest('content/get', { spaceId, id: stagingDoc.id }))).toBeNull();
    const refused = await rest('content/publish', { spaceId, id: stagingDoc.id });
    expect(refused.status).toBe(404);
    expect((await json(refused)).error.key).toBe('content.notFound');
    const back = await rest(
      'content/delete',
      { spaceId, id: productionDoc.id },
      { environment: 'staging' },
    );
    expect(back.status).toBe(404);
    expect(await api.repos.content.findById(productionDoc.id)).not.toBeNull();
  });

  it("keeps each environment's content types", async () => {
    const names = async (environment?: string) =>
      (await json(await rest('contentTypes/list', { spaceId }, { environment })))
        .filter((type: { spaceId: string | null }) => type.spaceId === spaceId)
        .map((type: { id: string }) => type.id)
        .sort();
    expect(await names()).toEqual([articleId]);
    expect(await names('staging')).toEqual([stagingArticleId, promoId].sort());
    expect(stagingArticleId).not.toBe(articleId);

    // A type only staging has validates there and is unknown in production.
    const refused = await rest('content/create', {
      spaceId,
      typeId: promoId,
      title: 'Promo',
      fields: {},
    });
    expect(refused.status).toBe(404);
    expect((await json(refused)).error.key).toBe('contentType.notFound');
    const made = await rest(
      'content/create',
      { spaceId, typeId: promoId, title: 'Promo', fields: { summary: 'x' } },
      { environment: 'staging' },
    );
    expect(made.status).toBe(200);
    const typeRefused = await rest('contentTypes/get', { spaceId, id: promoId });
    expect(typeRefused.status).toBe(404);
  });

  it('answers an unknown environment with environment.notFound', async () => {
    const response = await rest('content/list', { filter: { spaceId, environment: 'nope' } });
    expect(response.status).toBe(404);
    expect((await json(response)).error.key).toBe('environment.notFound');
  });

  it('takes the environment header on the RPC transport too', async () => {
    const call = (environment?: string) =>
      apiApp.request('/rpc/content/get', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': superKey,
          ...(environment ? { 'x-manablox-environment': environment } : {}),
        },
        body: JSON.stringify({ json: { spaceId, id: stagingDoc.id } }),
      });
    expect((await json(await call('staging'))).json).toMatchObject({ id: stagingDoc.id });
    expect((await json(await call())).json).toBeNull();
  });

  it('refuses an API key in environments it is not allowed', async () => {
    const refused = await rest(
      'content/list',
      { filter: { spaceId } },
      { key: productionKey, environment: 'staging' },
    );
    expect(refused.status).toBe(403);
    expect((await json(refused)).error.key).toBe('environment.forbidden');
    expect(
      (await rest('content/list', { filter: { spaceId } }, { key: productionKey })).status,
    ).toBe(200);
  });

  it('needs the environments feature for any other environment than production', async () => {
    await setControls({ features: { environments: { enabled: false } } });
    try {
      const refused = await rest('content/list', { filter: { spaceId, environment: 'staging' } });
      expect(refused.status).toBe(403);
      expect((await json(refused)).error.key).toBe('control.feature');
      expect((await rest('content/list', { filter: { spaceId } })).status).toBe(200);
    } finally {
      await setControls({ features: { environments: { enabled: true } } });
    }
  });

  it('checks no count limit for staging creates', async () => {
    await setControls({ limits: { documents: { max: 1, mode: 'hard' } } });
    try {
      const staged = await rest(
        'content/create',
        { spaceId, typeId: stagingArticleId, title: 'More', fields: {} },
        { environment: 'staging' },
      );
      expect(staged.status).toBe(200);
      const refused = await rest('content/create', {
        spaceId,
        typeId: articleId,
        title: 'More',
        fields: {},
      });
      expect(refused.status).toBe(409);
      expect((await json(refused)).error.key).toBe('control.limit');
    } finally {
      const cleared = await apiApp.request(
        `/control/v1/settings/limits.documents?scope=space:${spaceId}`,
        { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } },
      );
      expect(cleared.status).toBeLessThan(300);
      api.controlStore.forget(null);
    }
  });

  it('keeps a home page per environment', async () => {
    expect(await api.repos.content.findHome(production, 'en')).toMatchObject({
      id: productionDoc.id,
    });
    expect(await api.repos.content.findHome(staging, 'en')).toMatchObject({ id: stagingDoc.id });
    const space = await api.repos.spaces.findById(spaceId);
    expect(space?.settings.homeContentId).toBe(productionDoc.id);
  });
});

describe('the space export', () => {
  const exported = async (query: string, headers: Record<string, string> = {}) =>
    apiApp.request(`/transfer/${spaceId}/export?sections=contents,contentTypes${query}`, {
      headers: { 'x-api-key': superKey, ...headers },
    });
  const titles = (payload: Record<string, any>) =>
    payload.contents.map((row: { title: string }) => row.title);
  const keyOf = async (response: Response) => {
    const body = await json(response);
    return body.error?.key ?? body.key;
  };

  it('exports production unless the query or the header names an environment', async () => {
    const live = await json(await exported(''));
    expect(titles(live)).toContain('Live news');
    expect(titles(live)).not.toContain('Draft news');
    expect(live.space.settings.homeContentId).toBe(productionDoc.id);

    const byQuery = await exported('&environment=staging');
    expect(byQuery.headers.get('content-disposition')).toContain('env-staging-');
    const staged = await json(byQuery);
    expect(titles(staged)).toContain('Draft news');
    expect(titles(staged)).not.toContain('Live news');
    expect(staged.contentTypes.map((type: { id: string }) => type.id)).toEqual(
      expect.arrayContaining([stagingArticleId, promoId]),
    );
    expect(staged.contentTypes.map((type: { id: string }) => type.id)).not.toContain(articleId);
    // Its own home page, as the space's.
    expect(staged.space.settings.homeContentId).toBe(stagingDoc.id);
    expect(staged.space.settings.environments).toBeUndefined();

    const byHeader = await json(await exported('', { 'x-manablox-environment': 'staging' }));
    expect(titles(byHeader)).toEqual(titles(staged));
  });

  it('applies the feature and API key rules of other environment requests', async () => {
    const forbidden = await exported('&environment=staging', { 'x-api-key': productionKey });
    expect(forbidden.status).toBe(403);
    expect(await keyOf(forbidden)).toBe('environment.forbidden');
    expect((await exported('&environment=nowhere')).status).toBe(404);

    await setControls({ features: { environments: { enabled: false } } });
    try {
      const off = await exported('&environment=staging');
      expect(off.status).toBe(403);
      expect(await keyOf(off)).toBe('control.feature');
      expect((await exported('')).status).toBe(200);
    } finally {
      await setControls({ features: { environments: { enabled: true } } });
    }
  });
});

describe('the management GraphQL API', () => {
  const byPermalink = (permalink: string) =>
    `{ contentByPermalink(permalink: "${permalink}") { id title } }`;

  it('reads the environment of the environment header', async () => {
    const staged = await graphql(byPermalink('draft-news'), {
      'x-manablox-space': spaceId,
      'x-manablox-environment': 'staging',
    });
    expect(staged.headers.get('x-robots-tag')).toContain('noindex');
    expect((await json(staged)).data.contentByPermalink).toMatchObject({ id: stagingDoc.id });

    const live = await graphql(byPermalink('draft-news'), { 'x-manablox-space': spaceId });
    expect(live.headers.get('x-robots-tag')).toBeNull();
    expect((await json(live)).data.contentByPermalink).toBeNull();
    const byId = await graphql(`{ content(id: "${stagingDoc.id}") { id } }`, {
      'x-manablox-space': spaceId,
    });
    expect((await json(byId)).data.content).toBeNull();
  });

  it('builds the schema of the environment', async () => {
    const query = '{ contentsPage(type: "promo") { total } }';
    const staged = await json(
      await graphql(query, { 'x-manablox-space': spaceId, 'x-manablox-environment': 'staging' }),
    );
    expect(staged.errors).toBeUndefined();
    expect(staged.data.contentsPage.total).toBe(0);
    const live = await json(await graphql(query, { 'x-manablox-space': spaceId }));
    expect(live.errors?.[0]?.extensions?.key).toBe('contentType.notFound');
  });

  it('refuses another environment while the feature is off', async () => {
    await setControls({ features: { environments: { enabled: false } } });
    try {
      const refused = await graphql(byPermalink('draft-news'), {
        'x-manablox-space': spaceId,
        'x-manablox-environment': 'staging',
      });
      expect(refused.status).toBe(403);
    } finally {
      await setControls({ features: { environments: { enabled: true } } });
    }
  });
});

describe('the public API', () => {
  it("serves an API host's environment, staging never indexed", async () => {
    const staged = await onHost(pubApp, 'api.staging.env.test', '/v1/content');
    expect(staged.status).toBe(200);
    expect(staged.headers.get('x-robots-tag')).toContain('noindex');
    const stagedIds = (await json(staged)).items.map((item: { id: string }) => item.id);
    expect(stagedIds).toContain(stagingDoc.id);
    expect(stagedIds).not.toContain(productionDoc.id);

    const live = await onHost(pubApp, 'api.env.test', '/v1/content');
    expect(live.headers.get('x-robots-tag')).toBeNull();
    expect((await json(live)).items.map((item: { id: string }) => item.id)).toEqual([
      productionDoc.id,
    ]);
    // Cached per environment: the second staging read is the staging answer again.
    const again = await onHost(pubApp, 'api.staging.env.test', '/v1/content');
    expect((await json(again)).items.map((item: { id: string }) => item.id)).toEqual(stagedIds);

    const crossed = await onHost(pubApp, 'api.env.test', `/v1/content/${stagingDoc.id}`);
    expect(crossed.status).toBe(404);
  });

  it('serves an asset only staging publishes on staging hosts, never cached there', async () => {
    const asset = await api.repos.assets.create({
      spaceId,
      driver: 'local',
      key: `${spaceId}/staged.txt`,
      filename: 'staged.txt',
      name: 'Staged',
      mimeType: 'text/plain',
      size: 6,
    });
    await api.storage.put(asset.key, Buffer.from('staged'), { contentType: 'text/plain' });
    await api.repos.assetUsages.recordPublished(stagingDoc.id, spaceId, [asset.id]);

    const path = `/media/${asset.id}/original`;
    expect((await onHost(pubApp, 'api.env.test', path)).status).toBe(404);
    const staged = await onHost(pubApp, 'api.staging.env.test', path);
    expect(staged.status).toBe(200);
    expect(staged.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers GraphQL on a staging host with the staging content', async () => {
    const response = await graphql(
      '{ contentByPermalink(permalink: "draft-news") { id } }',
      {},
      pubApp,
      'api.staging.env.test',
    );
    expect((await json(response)).data.contentByPermalink).toMatchObject({ id: stagingDoc.id });
  });

  it('does not know a staging host while the feature is off', async () => {
    await setControls({ features: { environments: { enabled: false } } });
    try {
      expect((await onHost(pubApp, 'api.staging.env.test', '/v1/content')).status).toBe(404);
      expect((await onHost(pubApp, 'api.env.test', '/v1/content')).status).toBe(200);
    } finally {
      await setControls({ features: { environments: { enabled: true } } });
    }
  });
});

describe('kept lookups on the public API', () => {
  // Stands in for Redis: the API's purges reach the public process's caches, shared and local.
  let relay: () => void = () => {};
  beforeAll(() => {
    relay = api.manablox.hooks.on('cache:purge', async ({ tags }) => {
      await pub.manablox.hooks.run(
        'cache:purge',
        { tags },
        { manablox: pub.manablox, spaceId: null },
      );
    });
  });
  afterAll(() => relay());

  it('serves a new API host at once and forgets a removed one', async () => {
    expect((await onHost(pubApp, 'late.env.test', '/v1/content')).status).toBe(404);
    const host = await api.apiHosts.create(production, 'late.env.test');
    expect((await onHost(pubApp, 'late.env.test', '/v1/content')).status).toBe(200);
    await api.apiHosts.delete(production, host.id);
    expect((await onHost(pubApp, 'late.env.test', '/v1/content')).status).toBe(404);
  });

  it("reads a space's new default locale at once", async () => {
    const list = async () =>
      (await json(await onHost(pubApp, 'api.env.test', '/v1/content'))).items.length;
    expect(await list()).toBe(1);
    await api.spaces.update(spaceId, { locales: ['en', 'de'], defaultLocale: 'de' });
    try {
      expect(await list()).toBe(0);
    } finally {
      await api.spaces.update(spaceId, { defaultLocale: 'en', locales: ['en'] });
    }
    expect(await list()).toBe(1);
  });
});
