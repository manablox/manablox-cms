import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  DRAFT_ASSET_ID,
  EXPIRED_ASSET_ID,
  FUTURE_ASSET_ID,
  initialised,
  OTHER_SPACE_ASSET_ID,
  stubRuntime,
} from './helpers/runtime.js';

const build = async () => {
  const { runtime, calls } = stubRuntime({
    server: { mode: 'public' as const },
    publicApi: { spaceId: ids.space },
  });
  await initialised(runtime);
  return { app: await createApp(runtime), calls };
};

const get = async (app: Awaited<ReturnType<typeof createApp>>, path: string) =>
  app.request(new Request(`http://public.test${path}`));

const json = async <T>(app: Awaited<ReturnType<typeof createApp>>, path: string): Promise<T> => {
  const response = await get(app, path);
  return (await response.json()) as T;
};

describe('public REST surface', () => {
  it('lists published documents as a plain field map', async () => {
    const { app } = await build();
    const body = await json<{ items: Array<{ type: string; fields: Record<string, unknown> }> }>(
      app,
      '/v1/content?type=page&limit=2',
    );

    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.type).toBe('page');
    // A keyed map, not a tagged union.
    expect(body.items[0]?.fields.summary).toBe('from the pinned space');
    // Unexpanded relations stay as ids.
    expect(body.items[0]?.fields.hero).toBe(ids.asset);
  });

  it('reads only the published projection', async () => {
    const { app, calls } = await build();
    await get(app, '/v1/content');
    expect(calls.listFilters[0]?.spaceId).toBe(ids.space);
  });

  it('omits role-gated fields, exactly as the GraphQL schema does', async () => {
    const { app } = await build();
    const body = await json<{ items: Array<{ fields: Record<string, unknown> }> }>(
      app,
      '/v1/content?limit=1',
    );
    expect(body.items[0]?.fields).not.toHaveProperty('internal_note');
  });

  it('inlines relations on request', async () => {
    const { app } = await build();
    const body = await json<{
      items: Array<{ fields: { hero: { id: string; url: string }; author: { name: string } } }>;
    }>(app, '/v1/content?limit=1&expand=hero,author');

    expect(body.items[0]?.fields.hero.id).toBe(ids.asset);
    expect(body.items[0]?.fields.hero.url).toContain('http');
    expect(body.items[0]?.fields.author.name).toBe('Ada');
  });

  it('keeps expansion of a 50-item list within the same query budget as GraphQL', async () => {
    const { app, calls } = await build();
    await get(app, '/v1/content?limit=50&expand=hero,author');

    // Batched, not one query per item.
    expect(calls.queries.length).toBeLessThanOrEqual(7);
    expect(calls.queries.filter((q) => q === 'assets.listByIds')).toHaveLength(1);
    expect(calls.queries.filter((q) => q === 'users.listByIds')).toHaveLength(1);
    // Tags of the whole page, and of the assets it inlines, in one query each.
    expect(calls.queries.filter((q) => q === 'tags.listByLocalizations')).toHaveLength(1);
    expect(calls.queries.filter((q) => q === 'tags.listByAssets')).toHaveLength(1);
  });

  it('resolves a permalink, including a nested path', async () => {
    const { app } = await build();
    const body = await json<{ id: string; permalink: string }>(app, '/v1/permalink/about/team');
    expect(body.permalink).toBe('pinned');
  });

  it('resolves the home page at the bare permalink route', async () => {
    const { app, calls } = await build();
    const response = await get(app, '/v1/permalink?locale=de');
    expect(response.status).toBe(200);
    expect(calls.permalinks).toEqual(['']);
  });

  it('404s an unknown document rather than returning null', async () => {
    const { app } = await build();
    const response = await get(app, '/v1/content/22222222-2222-4222-8222-222222222222');
    expect(response.status).toBe(404);
  });

  it('serves a menu by name, nested, with each document inlined', async () => {
    const { app, calls } = await build();
    const body = await json<{
      machineName: string;
      items: Array<{
        label: string;
        url: string | null;
        target: string;
        content: { id: string; type: string } | null;
        children: Array<{ label: string }>;
      }>;
    }>(app, '/v1/menus/main');

    expect(body.machineName).toBe('main');
    expect(body.items.map((item) => item.label)).toEqual(['Home', 'Blog']);
    expect(body.items[0]?.content?.type).toBe('page');
    expect(body.items[0]?.children[0]?.label).toBe('Team');
    // A link entry has a URL, no document, and a target.
    expect(body.items[1]?.url).toBe('https://blog.example.test');
    expect(body.items[1]?.content).toBeNull();
    expect(body.items.map((item) => item.target)).toEqual(['_self', '_blank']);
    // Published only, in the pinned space's default locale.
    expect(calls.menuLookups[0]).toEqual(['main', 'en', true]);
  });

  it('falls back to the default locale of the pinned space, not a fixed one', async () => {
    const { runtime, calls } = stubRuntime({
      server: { mode: 'public' as const },
      publicApi: { spaceId: ids.space },
    });
    await initialised(runtime);
    const [space] = await runtime.repos.spaces.listByIds([ids.space]);
    if (space) space.defaultLocale = 'de';
    const app = await createApp(runtime);

    expect((await get(app, '/v1/menus/main')).status).toBe(200);
    expect((await get(app, '/v1/menus/main?locale=fr')).status).toBe(200);
    expect(calls.menuLookups.map(([, locale]) => locale)).toEqual(['de', 'fr']);
  });

  it('404s an unknown menu', async () => {
    const { app } = await build();
    const response = await get(app, '/v1/menus/nope');
    expect(response.status).toBe(404);
  });

  it('describes the content model for SDK codegen', async () => {
    const { app } = await build();
    const body = await json<{
      types: Array<{
        name: string;
        fields: Array<{ name: string; kind: string; target?: string }>;
      }>;
    }>(app, '/v1/types');

    const page = body.types.find((type) => type.name === 'page');
    expect(page?.fields.map((field) => field.name)).toEqual(['summary', 'hero', 'author']);
    expect(page?.fields.find((field) => field.name === 'hero')?.target).toBe('asset');
  });

  it('serves asset metadata, and refuses an id from another space', async () => {
    const { app } = await build();
    expect((await json<{ id: string }>(app, `/v1/assets/${ids.asset}`)).id).toBe(ids.asset);
    expect((await get(app, `/v1/assets/${ids.author}`)).status).toBe(404);
  });

  it('publishes an OpenAPI document describing read operations only', async () => {
    const { app } = await build();
    const document = await json<{
      info: { title: string };
      paths: Record<string, Record<string, unknown>>;
    }>(app, '/openapi.json');

    expect(document.info.title).toBe('Manablox Delivery API');

    const methods = Object.values(document.paths).flatMap((path) => Object.keys(path));
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((method) => method === 'get')).toBe(true);
    // And it is the *delivery* document, not the management one.
    expect(Object.keys(document.paths).some((path) => path.includes('/content'))).toBe(true);
  });

  it('is not mounted on the management instance', async () => {
    const { runtime } = stubRuntime({});
    await initialised(runtime);
    const app = await createApp(runtime);
    expect((await get(app, '/v1/content')).status).toBe(404);
    // The management OpenAPI document is still the one at /openapi.json there.
    const document = (await (await get(app, '/openapi.json')).json()) as {
      info: { title: string };
    };
    expect(document.info.title).toBe('Manablox Management API');
  });
});

describe('surface parity', () => {
  /** REST and GraphQL must agree on every field value. */
  it('returns the same field values over REST and GraphQL', async () => {
    const { app } = await build();

    const rest = await json<{ id: string; title: string; fields: Record<string, unknown> }>(
      app,
      '/v1/content/11111111-1111-4111-8111-111111111111',
    );

    const response = await app.request(
      new Request('http://public.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `{ content(id: "11111111-1111-4111-8111-111111111111") {
            id title ... on Page { summary hero { id } author { id } }
          } }`,
        }),
      }),
    );
    const body = (await response.json()) as {
      data: { content: { id: string; title: string; summary: string; hero: { id: string } } };
    };

    expect(body.data.content.id).toBe(rest.id);
    expect(body.data.content.title).toBe(rest.title);
    expect(body.data.content.summary).toBe(rest.fields.summary);
    // GraphQL resolves the reference; REST returns the id unless asked to expand.
    expect(body.data.content.hero.id).toBe(rest.fields.hero);
  });
});

describe('asset exposure', () => {
  it('refuses a binary that no published document references', async () => {
    const { app } = await build();
    expect((await get(app, `/media/${ids.asset}/original`)).status).toBe(200);
    // Only used by an unpublished draft.
    expect((await get(app, `/media/${DRAFT_ASSET_ID}/original`)).status).toBe(404);
    expect((await get(app, `/v1/assets/${DRAFT_ASSET_ID}`)).status).toBe(404);
  });

  it('refuses a binary whose availability window is not open', async () => {
    const { app } = await build();
    // Both are used by a published document; the asset's own dates decide.
    expect((await get(app, `/media/${FUTURE_ASSET_ID}/original`)).status).toBe(404);
    expect((await get(app, `/media/${EXPIRED_ASSET_ID}/original`)).status).toBe(404);
  });

  it('caps how long a cache may hold a binary that is due to come down', async () => {
    const { app } = await build();
    const response = await get(app, `/media/${ids.asset}/original`);
    // Nothing scheduled: cached for a year.
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('refuses a binary belonging to another space', async () => {
    const { app } = await build();
    expect((await get(app, `/media/${OTHER_SPACE_ASSET_ID}/original`)).status).toBe(404);
  });

  it('serves both from the management instance', async () => {
    const { runtime } = stubRuntime({});
    await initialised(runtime);
    const app = await createApp(runtime);
    expect((await get(app, `/media/${ids.asset}/original`)).status).toBe(200);
    expect((await get(app, `/media/${DRAFT_ASSET_ID}/original`)).status).toBe(200);
  });
});

describe('a pinned space still importing', () => {
  it('answers every delivery surface as missing until the import finished', async () => {
    const { app, calls } = await build();
    calls.importing.add(ids.space);

    const rest = await get(app, '/v1/content');
    expect(rest.status).toBe(404);
    expect(((await rest.json()) as { error: { key: string } }).error.key).toBe('space.notFound');
    const graphql = await app.request(
      new Request('http://public.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ contentsPage(limit: 1) { items { id } } }' }),
      }),
    );
    expect(graphql.status).toBe(404);
    expect((await get(app, `/media/${ids.asset}/original`)).status).toBe(404);
    expect(calls.listFilters).toEqual([]);

    calls.importing.delete(ids.space);
    expect((await get(app, '/v1/content')).status).toBe(200);
  });
});
