import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { bootstrap, createApp, type ManagementRuntime, requireManagement } from '@manablox/server';
import { withControls } from '@manablox/services/testing';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { websitePlugin } from '../../src/index.js';
import { websiteOf } from '../helpers/runtime.js';

const KEY = 'website-space-create-key-0123456789';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let app: Hono;
let apiKey: string;
let restore: (() => Promise<void>) | null = null;
let seq = 0;

/** A fresh space input on its own host. */
const input = (website: unknown, extra: Record<string, unknown> = {}) => {
  const name = `site-${++seq}`;
  return {
    name,
    machineName: name,
    url: `http://${name}.site.test`,
    ...(website === undefined ? {} : { plugins: { website } }),
    ...extra,
  };
};

/** `spaces.create` over the management rpc, as an API key. */
const rpcCreate = async (body: unknown) => {
  const response = await app.request('/rpc/spaces/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ json: body }),
  });
  const payload = (await response.json()) as { json: Record<string, any> };
  return { status: response.status, body: payload.json };
};

const controlCreate = async (body: unknown) => {
  const response = await app.request('/control/v1/spaces', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
};

/** Two types that reference each other, as `ai.designContentTypes` proposes them. */
const PLAN = {
  types: [
    {
      name: 'highlight',
      kind: 'block',
      label: 'Highlight',
      fields: [{ name: 'headline', type: 'string', required: true }],
    },
    {
      name: 'event',
      kind: 'content',
      label: 'Event',
      hasSlug: true,
      fields: [
        { name: 'summary', type: 'string' },
        { name: 'sections', type: 'blocks', settings: { types: ['highlight'] } },
      ],
    },
  ],
};

const spaceNamed = async (machineName: string) =>
  (await api.repos.spaces.list()).find((space) => space.machineName === machineName);

/** Mode, open changes and domains of a space's site. */
async function siteOf(spaceId: string) {
  const settings = await websiteOf(api).settings.get(spaceId);
  const designs = await websiteOf(api).designs.list(spaceId);
  const domains = await websiteOf(api).domains.list(spaceId);
  return {
    mode: settings.mode,
    revision: settings.revision,
    stored: designs.filter((entry) => entry.id !== null).length,
    dirty: designs.filter((entry) => entry.status !== 'published' && entry.id !== null).length,
    domains: domains.map((domain) => ({ hostname: domain.hostname, isPrimary: domain.isPrimary })),
  };
}

beforeAll(async () => {
  db = await createTestDatabase('server_website_space_create', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-website-create-'));
  api = requireManagement(
    await bootstrap({
      plugins: [websitePlugin()],
      database: { url: db.url },
      auth: { secret: 'website-space-create-secret' },
      fieldTypes: builtinFieldTypes,
      logLevel: 'silent',
      storage: { driver: 'local', local: { path: join(dir, 'files') } },
      server: { rateLimit: false, scopes: ['rpc', 'auth', 'control'] },
      control: { apiKey: KEY },
    }),
  );
  app = await createApp(api);
  const admin = await api.repos.users.create({
    name: 'Admin',
    email: 'admin@site.test',
    role: 'superadmin',
    passwordHash: 'x',
  });
  apiKey = (await api.apiKeys.issue(admin.id, 'root')).key;
}, 60_000);

afterEach(async () => {
  await restore?.();
  restore = null;
  api.controlStore.forget(null);
});

afterAll(async () => {
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('a designed site in the space create', () => {
  it('sets up the theme and preset after the starter over rpc, published, with its domain', async () => {
    const data = input({ theme: 'builtin:bold' }, { starter: 'basic' });
    const { status, body } = await rpcCreate(data);
    expect(status).toBe(200);
    expect(body.warnings).toEqual([]);
    const site = await siteOf(body.id);
    expect(site).toMatchObject({
      mode: 'designed',
      dirty: 0,
      domains: [{ hostname: `${data.machineName}.site.test`, isPrimary: true }],
    });
    expect(site.revision).toBeGreaterThan(0);
    // The preset designs the starter's types, so they are stored rather than generated.
    const designs = await websiteOf(api).designs.list(body.id);
    expect(designs.some((entry) => entry.kind === 'page' && entry.id !== null)).toBe(true);
  });

  it('designs the types of a plan, created with the space before the site is set up', async () => {
    const data = input({ theme: 'builtin:bold' }, { plan: PLAN });
    const { status, body } = await rpcCreate(data);
    expect(status).toBe(200);
    expect(body.warnings).toEqual([]);
    const types = api.manablox.contentTypes.forSpace(body.id).filter((type) => type.spaceId);
    const event = types.find((type) => type.name === 'event');
    expect(types.map((type) => type.name).sort()).toEqual(['event', 'highlight']);
    const designs = await websiteOf(api).designs.list(body.id);
    // Stored rather than generated: the preset designed the planned type.
    const page = designs.find((entry) => entry.kind === 'page' && entry.key === event?.id);
    expect(page?.id).toEqual(expect.any(String));
    expect(await siteOf(body.id)).toMatchObject({ mode: 'designed', dirty: 0 });
  });

  it('refuses an invalid plan and leaves neither space nor types behind', async () => {
    const data = input(
      {},
      {
        plan: {
          types: [
            {
              name: 'broken',
              kind: 'content',
              fields: [{ name: 'parts', type: 'blocks', settings: { types: ['nope'] } }],
            },
          ],
        },
      },
    );
    const { status } = await rpcCreate(data);
    expect(status).toBe(422);
    expect(await spaceNamed(data.machineName)).toBeUndefined();
    expect(api.manablox.contentTypes.all.some((type) => type.name === 'broken')).toBe(false);
  });

  it('keeps only the theme with a null preset', async () => {
    const { body } = await rpcCreate(input({ theme: 'builtin:neutral', preset: null }));
    const designs = await websiteOf(api).designs.list(body.id);
    expect(designs.filter((entry) => entry.kind === 'page' && entry.id !== null)).toEqual([]);
    expect((await siteOf(body.id)).mode).toBe('designed');
  });

  it('leaves the site external without website data', async () => {
    const { body } = await rpcCreate(input(undefined));
    expect(body.warnings).toEqual([]);
    expect(await siteOf(body.id)).toMatchObject({ mode: 'external', stored: 0, domains: [] });
  });

  it('warns and keeps the space when it has no address for the site', async () => {
    const { status, body } = await rpcCreate({ ...input({}), url: null });
    expect(status).toBe(200);
    expect(body.warnings).toEqual([
      'The site has no address yet. Add a domain under Settings, API hosts.',
    ]);
    expect(await siteOf(body.id)).toMatchObject({ mode: 'designed', domains: [] });
  });

  it('warns and keeps the space when the host is taken', async () => {
    const first = input({});
    await rpcCreate(first);
    const second = { ...input({}), url: first.url };
    const { status, body } = await rpcCreate(second);
    expect(status).toBe(200);
    expect(body.warnings).toEqual([
      expect.stringContaining(`could not use ${first.machineName}.site.test`),
    ]);
    expect(await siteOf(body.id)).toMatchObject({ mode: 'designed', dirty: 0, domains: [] });
  });

  it('refuses unknown themes and presets before writing anything', async () => {
    for (const website of [
      { theme: 'builtin:nope' },
      { theme: 'code:nope' },
      { theme: 'builtin:bold', preset: 'nope' },
    ]) {
      const data = input(website);
      const { status, body } = await rpcCreate(data);
      expect(status).toBe(422);
      expect(body.data).toMatchObject({ key: 'space.validation.failed' });
      expect(await spaceNamed(data.machineName)).toBeUndefined();
    }
  });

  it('refuses a designed site while the instance allows none', async () => {
    restore = await withControls(api, {
      values: { 'features.plugins.website': { enabled: false } },
    });
    const data = input({});
    const { status } = await rpcCreate(data);
    expect(status).toBe(403);
    expect(await spaceNamed(data.machineName)).toBeUndefined();
  });

  it('takes the website data through the control API', async () => {
    const data = input({ theme: 'builtin:bold', preset: 'atlas' }, { starter: true });
    const created = await controlCreate(data);
    expect(created).toMatchObject({ status: 201 });
    const { body } = created;
    expect(body.warnings).toEqual([]);
    expect(await siteOf(body.id)).toMatchObject({
      mode: 'designed',
      dirty: 0,
      domains: [{ hostname: `${data.machineName}.site.test`, isPrimary: true }],
    });

    const planned = await controlCreate(input({}, { plan: PLAN }));
    expect(planned).toMatchObject({ status: 201 });
    expect(
      api.manablox.contentTypes
        .forSpace(planned.body.id)
        .filter((type) => type.spaceId)
        .map((type) => type.name)
        .sort(),
    ).toEqual(['event', 'highlight']);

    const taken = await controlCreate({ ...input({}), url: data.url });
    expect(taken).toMatchObject({ status: 201 });
    expect(taken.body.warnings).toEqual([expect.stringContaining('could not use')]);
  });
});
