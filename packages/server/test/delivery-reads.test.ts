import type { ManabloxConfig } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, type memoryCache, stubRuntime } from './helpers/runtime.js';

const PAGE = {
  name: 'page',
  fields: [
    { name: 'summary', type: 'string' },
    { name: 'hero', type: 'asset' },
    { name: 'author', type: 'user' },
    {
      name: 'latest',
      type: 'content',
      settings: { multiple: true, selection: 'filter', limit: 3 },
    },
    { name: 'gallery', type: 'asset', settings: { multiple: true, selection: 'filter', limit: 2 } },
  ],
};

const build = async (config: Partial<ManabloxConfig> = {}) => {
  const { runtime, calls, manablox } = stubRuntime({
    server: { mode: 'public' as const },
    publicApi: { spaceId: ids.space },
    cache: { enabled: false },
    contentTypes: [PAGE],
    ...config,
  } as Partial<ManabloxConfig>);
  await initialised(runtime);
  return { app: await createApp(runtime), calls, manablox, runtime };
};

type App = Awaited<ReturnType<typeof createApp>>;

const rest = (app: App, path: string) => app.request(new Request(`http://public.test${path}`));

const graphql = (app: App, query: string) =>
  app.request(
    new Request('http://public.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    }),
  );

/** Round trips per stubbed query, for comparing budgets. */
const tally = (queries: string[]) => {
  const out: Record<string, number> = {};
  for (const query of queries) out[query] = (out[query] ?? 0) + 1;
  return out;
};

// The space row (default locale, readiness) comes from the process's kept rows, not a
// query per request.
describe('delivery query budget', () => {
  it('batches a REST list with expansions and filter relations', async () => {
    const { app, calls } = await build();
    await rest(app, '/v1/content?limit=50&expand=hero,author,latest,gallery');
    expect(tally(calls.queries)).toEqual({
      'content.page': 2,
      'assets.page': 1,
      'users.listByIds': 1,
      'tags.listByLocalizations': 1,
      'tags.listByAssets': 1,
    });
  });

  it('batches a REST document by id', async () => {
    const { app, calls } = await build();
    await rest(app, '/v1/content/11111111-1111-4111-8111-111111111111?expand=hero,author');
    expect(calls.queries).toHaveLength(6);
    expect(calls.queries.filter((query) => query === 'content.listByIds')).toHaveLength(1);
  });

  it('keeps a REST permalink and menu to one lookup each', async () => {
    const { app, calls } = await build();
    await rest(app, '/v1/permalink/about?expand=hero');
    expect(calls.queries).toHaveLength(5);
    calls.queries.length = 0;
    await rest(app, '/v1/menus/main?expand=hero');
    expect(calls.queries).toHaveLength(5);
  });

  it('batches a GraphQL list across relations, parents and filter fields', async () => {
    const { app, calls } = await build();
    const response = await graphql(
      app,
      '{ contentsPage(limit: 10) { items { id ... on Page { hero { id tags { slug } } author { id } latest { id } gallery { id } parent { id } children { id } } } } }',
    );
    expect(((await response.json()) as { errors?: unknown }).errors).toBeUndefined();
    expect(tally(calls.queries)).toEqual({
      'content.page': 2,
      'assets.listByIds': 1,
      'assetUsages.filterPublished': 1,
      'users.listByIds': 1,
      'assets.page': 1,
      'tags.listByAssets': 1,
    });
  });

  it('costs contentsPage the same as contents', async () => {
    const { app, calls } = await build();
    const response = await graphql(
      app,
      '{ contentsPage(limit: 10) { total limit offset items { id ... on Page { hero { id } } } } }',
    );
    const body = (await response.json()) as {
      data: { contentsPage: { total: number; limit: number; offset: number; items: unknown[] } };
    };
    expect(body.data.contentsPage).toMatchObject({ total: 10, limit: 10, offset: 0 });
    expect(body.data.contentsPage.items).toHaveLength(10);
    expect(tally(calls.queries)).toEqual({
      'content.page': 1,
      'assets.listByIds': 1,
      'assetUsages.filterPublished': 1,
    });
  });
});

describe('shared page size', () => {
  it('refuses a limit above 100 on both surfaces', async () => {
    const { app } = await build();
    expect((await rest(app, '/v1/content?limit=101')).status).toBe(422);
    const body = (await (
      await graphql(app, '{ contentsPage(limit: 101) { items { id } } }')
    ).json()) as {
      errors?: Array<{ extensions?: { key?: string } }>;
    };
    expect(body.errors?.[0]?.extensions?.key).toBe('query.limit.invalid');
  });

  it('prices a contentsPage by its limit once, not again for its items', async () => {
    const { app } = await build();
    const fields = Array.from({ length: 12 }, (_, i) => `a${i}: title`).join(' ');
    const fits = (await (
      await graphql(app, `{ contentsPage(limit: 50) { total items { ${fields} } } }`)
    ).json()) as { errors?: unknown };
    expect(fits.errors).toBeUndefined();

    const tooWide = (await (
      await graphql(app, `{ contentsPage(limit: 100) { items { ${fields} } } }`)
    ).json()) as { errors?: Array<{ message: string }> };
    expect(tooWide.errors?.[0]?.message).toMatch(/maximum complexity/);
  });
});

describe('read hooks on delivery', () => {
  it('run on every public read, REST and GraphQL alike', async () => {
    const { app, manablox } = await build();
    const seen: string[] = [];
    manablox.hooks.on('field:afterRead', (value, { field }) =>
      field.name === 'summary' ? `${String(value)} (read)` : value,
    );
    manablox.hooks.on('content:afterRead', (row) => {
      seen.push(`row:${row?.id}`);
      return row;
    });
    manablox.hooks.on('content:afterReadMany', (rows, { actor, published }) => {
      seen.push(`many:${rows.length}:${actor === null}:${published}`);
      return rows;
    });
    manablox.hooks.on('content:afterList', (rows) => {
      seen.push(`list:${rows.length}`);
      return rows;
    });

    const list = (await (await rest(app, '/v1/content?limit=2')).json()) as {
      items: Array<{ fields: { summary: string } }>;
    };
    expect(list.items[0]?.fields.summary).toBe('from the pinned space (read)');
    // The page, then the rows of its `latest` filter relation.
    expect(seen).toEqual([
      'row:c0',
      'row:c1',
      'many:2:true:true',
      'list:2',
      'row:c0',
      'row:c1',
      'row:c2',
      'many:3:true:true',
    ]);

    seen.length = 0;
    const response = await graphql(
      app,
      '{ contentByPermalink(permalink: "about") { id ... on Page { summary } } }',
    );
    const body = (await response.json()) as {
      data: { contentByPermalink: { summary: string } };
    };
    expect(body.data.contentByPermalink.summary).toBe('from the pinned space (read)');
    expect(seen).toEqual(['row:c1', 'many:1:true:true']);
  });

  it('hides a document a hook drops, wherever it is read from', async () => {
    const { app, manablox } = await build();
    manablox.hooks.on('content:afterRead', (row) => (row?.id === 'c1' ? null : row));

    const list = (await (await rest(app, '/v1/content?limit=3')).json()) as {
      items: Array<{ id: string }>;
    };
    expect(list.items.map((item) => item.id)).toEqual(['c0', 'c2']);
    expect((await rest(app, '/v1/permalink/about')).status).toBe(404);

    const menu = (await (await rest(app, '/v1/menus/main')).json()) as {
      items: Array<{ label: string }>;
    };
    // `Home` holds c1, so it drops with the `Team` entry below it.
    expect(menu.items.map((item) => item.label)).toEqual(['Blog']);

    const response = await graphql(
      app,
      '{ contentsPage(limit: 3) { items { id } } content(id: "c1") { id } }',
    );
    expect(await response.json()).toEqual({
      data: { contentsPage: { items: [{ id: 'c0' }, { id: 'c2' }] }, content: null },
    });
  });
});

describe('content:beforeRead on delivery', () => {
  const DOC = '11111111-1111-4111-8111-111111111111';

  it('runs before single reads by id and permalink, not for lists or relations', async () => {
    const { app, manablox } = await build();
    const seen: unknown[] = [];
    manablox.hooks.on('content:beforeRead', ({ id }, { actor, spaceId, published }) => {
      seen.push({ id, actor, spaceId, published });
    });

    expect((await rest(app, `/v1/content/${DOC}?expand=latest`)).status).toBe(200);
    expect((await rest(app, '/v1/permalink/about')).status).toBe(200);
    expect((await rest(app, '/v1/content?limit=2')).status).toBe(200);
    const response = await graphql(
      app,
      `{ content(id: "${DOC}") { id } contentByPermalink(permalink: "about") { id } }`,
    );
    expect(await response.json()).toEqual({
      data: { content: { id: DOC }, contentByPermalink: { id: 'c1' } },
    });

    const scope = { actor: null, spaceId: ids.space, published: true };
    expect(seen).toEqual([
      { id: DOC, ...scope },
      { id: 'c1', ...scope },
      { id: DOC, ...scope },
      { id: 'c1', ...scope },
    ]);
  });

  it('refuses a read as not found when a handler throws', async () => {
    const { app, manablox } = await build();
    manablox.hooks.on('content:beforeRead', () => {
      throw new Error('refused');
    });

    const byId = await rest(app, `/v1/content/${DOC}`);
    expect(byId.status).toBe(404);
    expect(await byId.json()).toMatchObject({ error: { key: 'content.notFound' } });
    const byPermalink = await rest(app, '/v1/permalink/about');
    expect(byPermalink.status).toBe(404);
    expect(JSON.stringify(await byPermalink.json())).not.toContain('c1');
    expect((await rest(app, '/v1/content?limit=2')).status).toBe(200);

    const response = await graphql(
      app,
      `{ content(id: "${DOC}") { id } contentByPermalink(permalink: "about") { id } }`,
    );
    const body = (await response.json()) as {
      data: Record<string, unknown>;
      errors: Array<{ extensions?: { key?: string } }>;
    };
    expect(body.data).toEqual({ content: null, contentByPermalink: null });
    expect(body.errors).toHaveLength(2);
    expect(body.errors.map((error) => error.extensions?.key)).toEqual([
      'content.notFound',
      'content.notFound',
    ]);
  });
});

describe('asset list cache tags', () => {
  it('files a filter relation over assets under the space asset lists', async () => {
    const { app, runtime } = await build({ cache: { enabled: true } } as Partial<ManabloxConfig>);
    const cache = runtime.cache as unknown as ReturnType<typeof memoryCache>;

    await rest(app, '/v1/content/11111111-1111-4111-8111-111111111111');
    await graphql(
      app,
      '{ contentsPage(limit: 1) { items { id ... on Page { gallery { id } } } } }',
    );
    await graphql(app, '{ contentsPage(limit: 1) { items { id } } }');
    expect(cache.entries.size).toBe(3);
    expect(cache.tags.get(`asset-list:${ids.space}`)?.size).toBe(2);

    // What an upload purges.
    await runtime.manablox.hooks.run(
      'cache:purge',
      { tags: [`asset-list:${ids.space}`] },
      { manablox: runtime.manablox, spaceId: ids.space },
    );
    expect(cache.entries.size).toBe(1);
  });
});
