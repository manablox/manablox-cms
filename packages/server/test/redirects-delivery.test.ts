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

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let pub: Runtime;
let pubApp: Hono;
let spaceId: string;
let production: ResolvedScope;
let staging: ResolvedScope;
let about: { id: string; localizationId: string };

const json = async (response: Response) => (await response.json()) as Record<string, any>;

const onHost = (host: string, path: string) => pubApp.request(new Request(`http://${host}${path}`));

const graphql = (host: string, query: string) =>
  pubApp.request(
    new Request(`http://${host}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    }),
  );

beforeAll(async () => {
  db = await createTestDatabase('server_redirects_delivery');
  dir = await mkdtemp(join(tmpdir(), 'manablox-redirects-'));
  const config = {
    database: { url: db.url },
    auth: { secret: 'redirects-delivery-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
    logLevel: 'silent' as const,
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
    cache: { enabled: true, ttl: 300 },
  };
  api = requireManagement(
    await bootstrap({ ...config, server: { rateLimit: false, scopes: ['rpc', 'graphql'] } }),
  );
  const space = await api.repos.spaces.create({
    name: 'Redirects',
    machineName: 'redirects',
    url: 'https://redirects.test',
    defaultLocale: 'en',
    locales: ['en', 'de'],
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

  const typeId = (
    await api.contentTypes.create({
      name: 'page',
      spaceId,
      fields: [{ name: 'summary', type: 'string' }],
    })
  ).id;
  const page = (title: string, slug: string) =>
    api.content.create({ spaceId, typeId, title, slug, fields: {} });
  about = await page('About', 'about');
  await api.content.publish(spaceId, about.id);
  const draft = await page('Draft', 'draft');

  await api.redirects.create(production, { fromPath: '/old', toContentId: about.localizationId });
  await api.redirects.create(production, { fromPath: '/x', toPath: '/y', status: 302 });
  await api.redirects.create(production, { fromPath: '/x', toPath: '/z', locale: 'de' });
  await api.redirects.create(production, {
    fromPath: '/hidden',
    toContentId: draft.localizationId,
  });
  await api.redirects.create(staging, { fromPath: '/staged', toPath: 'https://example.com/s' });

  await api.apiHosts.create(production, 'api.redirects.test');
  await api.apiHosts.create(staging, 'api.staging.redirects.test');

  pub = await bootstrap({ ...config, server: { mode: 'public', rateLimit: false } });
  pubApp = await createApp(pub);
}, 90_000);

afterAll(async () => {
  await pub?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('redirects delivery', () => {
  it('lists a locale over REST with document targets resolved and hidden ones left out', async () => {
    const response = await onHost('api.redirects.test', '/v1/redirects');
    expect(response.status).toBe(200);
    expect((await json(response)).items).toEqual([
      { locale: null, fromPath: '/old', toPath: '/about', status: 301, contentId: about.id },
      { locale: null, fromPath: '/x', toPath: '/y', status: 302, contentId: null },
    ]);

    // The locale's own redirect wins; the document has no German version.
    const de = await json(await onHost('api.redirects.test', '/v1/redirects?locale=de'));
    expect(de.items).toEqual([
      { locale: 'de', fromPath: '/x', toPath: '/z', status: 301, contentId: null },
    ]);
  });

  it('answers the same over GraphQL', async () => {
    const response = await graphql(
      'api.redirects.test',
      '{ redirects { locale fromPath toPath status contentId } }',
    );
    const rest = await json(await onHost('api.redirects.test', '/v1/redirects'));
    expect((await json(response)).data.redirects).toEqual(rest.items);
  });

  it("serves a staging host its environment's redirects", async () => {
    const response = await onHost('api.staging.redirects.test', '/v1/redirects');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect((await json(response)).items).toEqual([
      {
        locale: null,
        fromPath: '/staged',
        toPath: 'https://example.com/s',
        status: 301,
        contentId: null,
      },
    ]);
  });

  it('drops the cached answer when a redirect changes', async () => {
    const paths = async () =>
      (await json(await onHost('api.redirects.test', '/v1/redirects'))).items.map(
        (item: { fromPath: string }) => item.fromPath,
      );
    expect(await paths()).toEqual(['/old', '/x']);
    const added = await pub.redirects.create(production, { fromPath: '/new', toPath: '/y' });
    expect(await paths()).toEqual(['/new', '/old', '/x']);
    await pub.redirects.delete(production, added.id);
    expect(await paths()).toEqual(['/old', '/x']);
  });

  it('is described in the OpenAPI document', async () => {
    const document = await json(await onHost('api.redirects.test', '/openapi.json'));
    expect(Object.keys(document.paths)).toContain('/redirects');
  });
});
