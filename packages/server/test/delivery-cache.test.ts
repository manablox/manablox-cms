import { fnv1a } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, type memoryCache, stubRuntime } from './helpers/runtime.js';

const build = async () => {
  const { runtime, calls } = stubRuntime({
    server: { mode: 'public' as const },
    publicApi: { spaceId: ids.space },
  });
  await initialised(runtime);
  const cache = runtime.cache as unknown as ReturnType<typeof memoryCache>;
  return { app: await createApp(runtime), calls, cache, runtime };
};

const graphql = (app: Awaited<ReturnType<typeof createApp>>, query: string, headers = {}) =>
  app.request(
    new Request('http://public.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query }),
    }),
  );

describe('delivery response cache', () => {
  it('serves a repeated query without touching the database again', async () => {
    const { app, calls } = await build();
    const query = `{ content(id: "${ids.doc}") { id title } }`;

    const first = await (await graphql(app, query)).json();
    const queriesAfterFirst = calls.queries.length;
    const second = await (await graphql(app, query)).json();

    expect(second).toEqual(first);
    expect(calls.queries.length).toBe(queriesAfterFirst);
    expect(queriesAfterFirst).toBeGreaterThan(0);
  });

  it('keeps queries apart that collide under a 32-bit hash', async () => {
    const { app, cache } = await build();
    const first = '{ a1vl8: contentsPage { items { id } } }';
    const second = '{ aipd6: contentsPage { items { id } } }';
    // Both hash to 785d77b1 under fnv1a; the second must not be served the first's answer.
    expect(fnv1a(first)).toBe(fnv1a(second));
    await graphql(app, first);
    const answer = await (await graphql(app, second)).json();
    expect(answer.data).toHaveProperty('aipd6');
    expect(cache.entries.size).toBe(2);
  });

  it('files an entry under the ids it actually read', async () => {
    const { app, cache } = await build();
    await graphql(app, `{ content(id: "${ids.doc}") { id } }`);

    expect([...cache.tags.keys()]).toContain(`content:${ids.doc}`);
    // A by-id read is not space-wide, so an unrelated publish must not purge it.
    expect([...cache.tags.keys()]).not.toContain(`space:${ids.space}`);
  });

  it('purges exactly the entries that referenced a published document', async () => {
    const { app, cache, runtime } = await build();

    await graphql(app, `{ content(id: "${ids.doc}") { id } }`);
    await graphql(app, `{ content(id: "${ids.doc}") { title } }`);
    // A different document; its entry must survive.
    await graphql(app, '{ content(id: "12111111-1111-4111-8111-111111111111") { id } }');
    expect(cache.entries.size).toBe(3);

    await runtime.manablox.hooks.run(
      'cache:purge',
      { tags: [`content:${ids.doc}`] },
      { manablox: runtime.manablox, spaceId: ids.space },
    );

    expect(cache.entries.size).toBe(1);
  });

  it('marks an unfiltered list as space-wide so a new document invalidates it', async () => {
    const { app, cache } = await build();
    await graphql(app, '{ contentsPage { items { id } } }');
    expect([...cache.tags.keys()]).toContain(`space:${ids.space}`);
  });

  it('files the home page under the space, where a new nomination purges it', async () => {
    const { app, cache, calls } = await build();
    await graphql(app, '{ contentByPermalink(permalink: "/") { id } }');
    expect(calls.permalinks).toEqual(['']);
    expect([...cache.tags.keys()]).toContain(`space:${ids.space}`);
  });

  it('does not cache a response carrying errors', async () => {
    const { app, cache } = await build();
    await graphql(app, '{ nonexistentField }');
    expect(cache.entries.size).toBe(0);
  });

  it('files an asset read under the asset, where an asset write purges it', async () => {
    const { app, cache, runtime } = await build();
    await graphql(app, `{ asset(id: "${ids.asset}") { id alt } }`);
    await graphql(app, `{ content(id: "${ids.doc}") { ... on Page { hero { url } } } }`);
    expect(cache.entries.size).toBe(2);
    expect([...cache.tags.keys()]).toContain(`asset:${ids.asset}`);

    await runtime.manablox.hooks.run(
      'cache:purge',
      { tags: [`asset:${ids.asset}`] },
      { manablox: runtime.manablox, spaceId: ids.space },
    );
    expect(cache.entries.size).toBe(0);
  });

  it('refuses a negative limit or offset', async () => {
    const { app } = await build();
    for (const args of ['limit: -1', 'offset: -5', 'limit: 0']) {
      const body = (await (
        await graphql(app, `{ contentsPage(${args}) { items { id } } }`)
      ).json()) as {
        errors?: unknown[];
      };
      expect(body.errors?.length, args).toBeGreaterThan(0);
    }
  });

  it('stores the digest with the entry and serves it as the ETag on a hit', async () => {
    const { app, cache } = await build();
    const query = `{ content(id: "${ids.doc}") { id title } }`;

    const miss = await graphql(app, query);
    const [entry] = [...cache.entries.values()] as Array<{ digest: string }>;
    expect(entry?.digest).toBeTruthy();
    expect(miss.headers.get('etag')).toBe(`W/"${entry?.digest}"`);

    const hit = await graphql(app, query);
    expect(hit.headers.get('etag')).toBe(`W/"${entry?.digest}"`);
    for (const each of [miss, hit]) {
      const length = Number(each.headers.get('content-length'));
      expect(length).toBe((await each.arrayBuffer()).byteLength);
    }
  });
});

describe('GraphQL hits before Yoga', () => {
  const send = (
    app: Awaited<ReturnType<typeof createApp>>,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    app.request(
      new Request('http://public.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    );

  it('answers a hit with the stored body and headers, without reading anything', async () => {
    const { app, calls } = await build();
    const query = `{ content(id: "${ids.doc}") { id title } }`;
    const miss = await send(app, { query });
    const missBody = await miss.text();
    const reads = calls.queries.length;
    const hit = await send(app, { query });
    expect(await hit.text()).toBe(missBody);
    expect(calls.queries.length).toBe(reads);
    for (const name of ['content-type', 'content-length', 'etag', 'cache-control']) {
      expect(hit.headers.get(name), name).toBe(miss.headers.get(name));
    }
  });

  it('shares an entry between GET and POST, and keeps operations apart', async () => {
    const { app, cache } = await build();
    const query = `query A { a: content(id: "${ids.doc}") { id } } query B { b: content(id: "${ids.doc}") { title } }`;
    const a = await (await send(app, { query, operationName: 'A' })).json();
    const b = await (await send(app, { query, operationName: 'B' })).json();
    expect(a.data).toHaveProperty('a');
    expect(b.data).toHaveProperty('b');
    expect(cache.entries.size).toBe(2);
    const url = `http://public.test/graphql?query=${encodeURIComponent(query)}&operationName=B`;
    const viaGet = await app.request(new Request(url));
    expect((await viaGet.json()).data).toHaveProperty('b');
    expect(cache.entries.size).toBe(2);
  });

  it('leaves a request for another response type to Yoga, which still hits', async () => {
    const { app, calls } = await build();
    const query = `{ content(id: "${ids.doc}") { id } }`;
    await send(app, { query });
    const reads = calls.queries.length;
    const other = await send(app, { query }, { accept: 'application/graphql-response+json' });
    expect(other.status).toBe(200);
    expect(other.headers.get('content-type')).toContain('application/graphql-response+json');
    expect((await other.json()).data.content.id).toBe(ids.doc);
    expect(calls.queries.length).toBe(reads);
  });

  it('keys on the variables as sent, in any order', async () => {
    const { app, cache } = await build();
    const query =
      'query Q($limit: Int, $offset: Int) { contentsPage(limit: $limit, offset: $offset) { items { id } } }';
    const first = await send(app, { query, variables: { limit: 1, offset: 0 } });
    expect((await first.json()).errors).toBeUndefined();
    await send(app, { query, variables: { offset: 0, limit: 1 } });
    expect(cache.entries.size).toBe(1);
  });
});

describe('REST response cache', () => {
  const rest = (app: Awaited<ReturnType<typeof createApp>>, path: string, headers = {}) =>
    app.request(new Request(`http://public.test${path}`, { headers }));

  it('serves a repeated read without touching the database again', async () => {
    const { app, calls } = await build();

    const first = await (await rest(app, `/v1/content/${ids.doc}`)).json();
    const queriesAfterFirst = calls.queries.length;
    const answer = await rest(app, `/v1/content/${ids.doc}`);
    // A known length, on the hit as on the miss.
    expect(Number(answer.headers.get('content-length'))).toBe(
      (await answer.clone().arrayBuffer()).byteLength,
    );
    const second = await answer.json();

    expect(second).toEqual(first);
    expect(calls.queries.length).toBe(queriesAfterFirst);
    expect(queriesAfterFirst).toBeGreaterThan(0);
  });

  it('keys on the path and the query, whatever the parameter order', async () => {
    const { app, cache } = await build();
    await rest(app, '/v1/content?limit=1&type=page');
    await rest(app, '/v1/content?type=page&limit=1');
    expect(cache.entries.size).toBe(1);
    await rest(app, '/v1/content?limit=2&type=page');
    expect(cache.entries.size).toBe(2);
  });

  it('keeps queries apart that collide under a 32-bit hash', async () => {
    const { app, cache } = await build();
    // Both query strings hash to ae413199 under fnv1a.
    expect(fnv1a('search=s15zx')).toBe(fnv1a('search=scpcd'));
    expect((await rest(app, '/v1/content?search=s15zx')).status).toBe(200);
    expect((await rest(app, '/v1/content?search=scpcd')).status).toBe(200);
    expect(cache.entries.size).toBe(2);
  });

  it('files an entry under the ids it actually read', async () => {
    const { app, cache } = await build();
    await rest(app, `/v1/content/${ids.doc}`);
    expect([...cache.tags.keys()]).toContain(`content:${ids.doc}`);
    expect([...cache.tags.keys()]).not.toContain(`space:${ids.space}`);
  });

  it('marks an unfiltered list as space-wide, a typed one under its type', async () => {
    const { app, cache, runtime } = await build();
    await rest(app, '/v1/content');
    expect([...cache.tags.keys()]).toContain(`space:${ids.space}`);

    await runtime.cache.clear();
    await rest(app, '/v1/content?type=page');
    const typeId = runtime.manablox.contentTypes.getByName('page').id;
    expect([...cache.tags.keys()]).toContain(`type:${typeId}`);
    expect([...cache.tags.keys()]).not.toContain(`space:${ids.space}`);
  });

  it('purges on publish exactly as GraphQL does, then reads afresh', async () => {
    const { app, cache, calls, runtime } = await build();

    await rest(app, `/v1/content/${ids.doc}`);
    await rest(app, `/v1/content/${ids.doc}?expand=hero`);
    await rest(app, '/v1/content/12111111-1111-4111-8111-111111111111');
    expect(cache.entries.size).toBe(3);

    await runtime.manablox.hooks.run(
      'cache:purge',
      { tags: [`content:${ids.doc}`] },
      { manablox: runtime.manablox, spaceId: ids.space },
    );
    expect(cache.entries.size).toBe(1);

    const before = calls.queries.length;
    await rest(app, `/v1/content/${ids.doc}`);
    expect(calls.queries.length).toBeGreaterThan(before);
  });

  it('files an expanded asset under the asset', async () => {
    const { app, cache } = await build();
    await rest(app, `/v1/content/${ids.doc}?expand=hero`);
    expect([...cache.tags.keys()]).toContain(`asset:${ids.asset}`);
    await rest(app, `/v1/assets/${ids.asset}`);
    expect(cache.tags.get(`asset:${ids.asset}`)?.size).toBe(2);
  });

  it('does not cache a miss', async () => {
    const { app, cache } = await build();
    const response = await rest(app, '/v1/content/22222222-2222-4222-8222-222222222222');
    expect(response.status).toBe(404);
    expect(cache.entries.size).toBe(0);
  });

  it('serves the stored digest as the ETag on a hit and answers 304 from it', async () => {
    const { app, cache } = await build();
    const miss = await rest(app, `/v1/content/${ids.doc}`);
    const [entry] = [...cache.entries.values()] as Array<{ digest: string }>;
    expect(miss.headers.get('etag')).toBe(`W/"${entry?.digest}"`);

    const hit = await rest(app, `/v1/content/${ids.doc}`, {
      'if-none-match': `W/"${entry?.digest}"`,
    });
    expect(hit.status).toBe(304);
  });
});

describe('http cache headers', () => {
  it('advertises a shared TTL on GET and answers a conditional request with 304', async () => {
    const { app } = await build();

    const first = await app.request(new Request('http://public.test/v1/content?limit=1'));
    expect(first.headers.get('cache-control')).toMatch(
      /public, max-age=0, s-maxage=\d+, stale-while-revalidate=\d+/,
    );

    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const second = await app.request(
      new Request('http://public.test/v1/content?limit=1', {
        headers: { 'if-none-match': etag as string },
      }),
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('hands back the whole body, and an ETag that follows it', async () => {
    const { app } = await build();

    const response = await app.request(new Request('http://public.test/v1/content?limit=1'));
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(JSON.parse(body)).toBeTypeOf('object');

    const etag = response.headers.get('etag') as string;
    // Weak: `<hash>-<length in hex>`.
    expect(etag).toMatch(/^W\/"[A-Za-z0-9_-]{16}-[0-9a-f]+"$/);

    // Same request, same tag.
    const again = await app.request(new Request('http://public.test/v1/content?limit=1'));
    expect(again.headers.get('etag')).toBe(etag);

    // Different query, different tag.
    const other = await app.request(new Request('http://public.test/v1/content?limit=2'));
    expect(other.headers.get('etag')).not.toBe(etag);
  });

  it('does not promise a shared cache anything about a POST', async () => {
    const { app } = await build();
    const response = await graphql(app, `{ content(id: "${ids.doc}") { id } }`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(response.headers.get('etag')).toBeTruthy();
  });

  it('marks an error response as uncacheable', async () => {
    const { app } = await build();
    const response = await graphql(app, '{ nope }');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not mistake a field named errors for a failure', async () => {
    const { app } = await build();
    const response = await graphql(app, `{ errors: content(id: "${ids.doc}") { id } }`);
    expect(await response.json()).toEqual({ data: { errors: { id: ids.doc } } });
    expect(response.headers.get('cache-control')).not.toBe('no-store');
    expect(response.headers.get('etag')).toBeTruthy();
  });

  it('hashes the body itself when the surface reports no digest', async () => {
    const { runtime } = stubRuntime({
      server: { mode: 'public' as const },
      publicApi: { spaceId: ids.space },
      cache: { enabled: false },
    });
    await initialised(runtime);
    const app = await createApp(runtime);
    const response = await app.request(new Request(`http://public.test/v1/content/${ids.doc}`));
    expect(response.headers.get('etag')).toMatch(/^W\/"[A-Za-z0-9_-]{16}-[0-9a-f]+"$/);
    expect((await response.json()).id).toBe(ids.doc);
  });

  it('adds no cache headers on the management instance', async () => {
    const { runtime } = stubRuntime({});
    await initialised(runtime);
    const app = await createApp(runtime);
    const response = await app.request(new Request('http://admin.test/openapi.json'));
    expect(response.headers.get('etag')).toBeNull();
  });
});
