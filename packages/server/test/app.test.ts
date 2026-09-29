import { expandScopes, MANAGEMENT_SCOPES, PUBLIC_SCOPES } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ASSET_BYTES, initialised, stubRuntime } from './helpers/runtime.js';

const build = async (config: Record<string, unknown> = {}, spaceId?: string) => {
  const { runtime, calls } = stubRuntime(config);
  await initialised(runtime);
  const app = await createApp(runtime, spaceId ? { spaceId } : {});
  return { app, calls, runtime };
};

const publicConfig = (over: Record<string, unknown> = {}) => ({
  server: { mode: 'public' as const },
  publicApi: { spaceId: ids.space, ...over },
});

const get = (app: Awaited<ReturnType<typeof createApp>>, path: string, init?: RequestInit) =>
  app.request(new Request(`http://public.test${path}`, init));

const graphql = (
  app: Awaited<ReturnType<typeof createApp>>,
  query: string,
  headers: Record<string, string> = {},
) =>
  app.request(
    new Request('http://public.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query }),
    }),
  );

describe('scopes', () => {
  it('drops duplicates and keeps the order', () => {
    expect(expandScopes(['graphql', 'media', 'graphql'])).toEqual(['graphql', 'media']);
  });

  it('serves reads and refuses writes for SCOPES=graphql,media', async () => {
    const { app } = await build({ server: { scopes: ['graphql', 'media'] } });

    expect((await get(app, '/rpc/content.list')).status).toBe(404);
    expect((await get(app, '/api/v1/content')).status).toBe(404);
    expect((await get(app, '/openapi.json')).status).toBe(404);
    expect((await get(app, '/api/auth/session')).status).toBe(404);
    expect((await get(app, '/upload/some-space', { method: 'POST' })).status).toBe(404);

    // Still served.
    expect((await get(app, '/media/missing/original')).status).toBe(404);
    expect((await graphql(app, '{ __typename }')).status).toBe(200);
  });

  it('mounts the management surface under the management preset', async () => {
    const { app } = await build({ server: { scopes: [...MANAGEMENT_SCOPES] } });
    expect((await get(app, '/openapi.json')).status).toBe(200);
    expect((await get(app, '/api/auth/session')).status).toBe(200);
  });

  it('mounts no management surface under the public preset', async () => {
    const { app } = await build({
      ...publicConfig(),
      server: { mode: 'public', scopes: [...PUBLIC_SCOPES] },
    });
    for (const path of ['/rpc/x', '/api/v1/content', '/api/auth/session']) {
      expect((await get(app, path)).status, path).toBe(404);
    }
    expect((await get(app, '/')).status).toBe(200);

    // `/openapi.json` is the delivery document here.
    const document = (await (await get(app, '/openapi.json')).json()) as {
      info: { title: string };
    };
    expect(document.info.title).toBe('Manablox Delivery API');
  });
});

describe('public mode', () => {
  it('pins the space from config and ignores the x-manablox-space header', async () => {
    const { app, calls } = await build(publicConfig());

    await graphql(app, '{ contentsPage { items { id } } }', { 'x-manablox-space': ids.otherSpace });

    expect(calls.listFilters).toHaveLength(1);
    expect(calls.listFilters[0]?.spaceId).toBe(ids.space);
  });

  it('removes the spaceId argument from the schema rather than ignoring it', async () => {
    const { app } = await build(publicConfig());

    const response = await graphql(
      app,
      `{ contentsPage(spaceId: "${ids.otherSpace}") { items { id } } }`,
    );
    const body = (await response.json()) as { errors?: { message: string }[] };

    // Must fail rather than silently ignore the argument.
    expect(body.errors?.[0]?.message).toMatch(/Unknown argument "spaceId"/);
  });

  it('still honours the spaceId argument on the management instance', async () => {
    const { app, calls } = await build({});
    await graphql(app, `{ contentsPage(spaceId: "${ids.otherSpace}") { items { id } } }`);
    expect(calls.listFilters[0]?.spaceId).toBe(ids.otherSpace);
  });

  it('scopes lookups by id to the pinned space', async () => {
    const { app, calls } = await build(publicConfig());
    await graphql(app, '{ content(id: "22222222-2222-4222-8222-222222222222") { id } }');

    expect(calls.listByIds[0]?.[1]).toBe(true);
    expect(calls.listByIds[0]?.[2]).toBe(ids.space);
  });

  it('gives an authenticated caller identical output to an anonymous one', async () => {
    const { app, calls } = await build(publicConfig());
    const query = '{ contentsPage { items { id title } } }';

    const anonymous = await (await graphql(app, query)).text();
    const credentialed = await (
      await graphql(app, query, {
        'x-api-key': 'a-real-key',
        'x-manablox-preview': '1',
        cookie: 'better-auth.session_token=abc',
      })
    ).text();

    expect(credentialed).toBe(anonymous);
    // No session or key lookup at all.
    expect(calls.principalLookups).toBe(0);
  });

  it('reads drafts only on the management instance, and only when authenticated', async () => {
    const { app, calls } = await build({});
    await graphql(app, '{ contentsPage { items { id } } }', {
      'x-manablox-preview': '1',
      'x-manablox-space': ids.space,
    });
    expect(calls.principalLookups).toBeGreaterThan(0);
    // The stub principal is null, so preview is refused.
    expect(calls.listFilters[0]?.spaceId).toBe(ids.space);
  });

  it('disables introspection', async () => {
    const { app } = await build(publicConfig());
    const body = (await (await graphql(app, '{ __schema { types { name } } }')).json()) as {
      errors?: { message: string }[];
    };
    expect(body.errors?.[0]?.message).toMatch(/Introspection is disabled/);
  });

  it('allows introspection when explicitly enabled', async () => {
    const { app } = await build(publicConfig({ introspection: true }));
    const body = (await (await graphql(app, '{ __schema { queryType { name } } }')).json()) as {
      data?: unknown;
      errors?: unknown;
    };
    expect(body.errors).toBeUndefined();
  });

  it('tightens the depth limit', async () => {
    const { app } = await build(publicConfig());
    const deep = `{ contentsPage { items { ${'parent { '.repeat(8)}id${' }'.repeat(8)} } } }`;
    const body = (await (await graphql(app, deep)).json()) as { errors?: { message: string }[] };
    expect(body.errors?.[0]?.message).toMatch(/maximum depth of 8/);
  });

  it('rejects a query whose estimated cost exceeds the complexity limit', async () => {
    const { app } = await build(publicConfig());
    const wide = `{ contentsPage(limit: 200) { items { ${Array.from({ length: 12 }, (_, i) => `a${i}: title`).join(' ')} } } }`;
    const body = (await (await graphql(app, wide)).json()) as { errors?: { message: string }[] };
    expect(body.errors?.[0]?.message).toMatch(/maximum complexity/);
  });

  it('answers CORS without credentials and without the preview header', async () => {
    const { app } = await build(publicConfig());
    const response = await get(app, '/graphql', {
      method: 'OPTIONS',
      headers: { origin: 'https://anywhere.test', 'access-control-request-method': 'POST' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('access-control-allow-headers') ?? '').not.toMatch(/preview/i);
  });

  it('serves a service document at the root', async () => {
    const { app } = await build(publicConfig());
    const body = (await (await get(app, '/')).json()) as {
      space: string;
      surfaces: Record<string, string>;
    };
    expect(body.space).toBe(ids.space);
    expect(body.surfaces.graphql).toBe('/graphql');
  });

  it('resolves the pinned space by machine name', async () => {
    const { app } = await build({
      server: { mode: 'public' },
      publicApi: { spaceMachineName: 'other' },
    });
    const body = (await (await get(app, '/')).json()) as { space: string };
    expect(body.space).toBe(ids.otherSpace);
  });

  it('refuses to start when the configured space does not exist', async () => {
    const { runtime } = stubRuntime({
      server: { mode: 'public' },
      publicApi: { spaceId: ids.missing },
    });
    await initialised(runtime);
    await expect(createApp(runtime)).rejects.toThrow(/publicApi.space.notFound/);
  });
});

describe('cross-origin delivery', () => {
  /** The default CORP `same-origin` would block cross-origin `<img>` loads. */
  it('lets another origin embed media from the public instance', async () => {
    const { app } = await build(publicConfig());
    const response = await get(app, `/media/${ids.asset}/original`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('lets the design canvas load management media, other routes stay same-origin', async () => {
    const { app } = await build({});
    const media = await get(app, `/media/${ids.asset}/original`);
    expect(media.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    const health = await get(app, '/healthz');
    expect(health.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  });
});

describe('media originals', () => {
  const original = `/media/${ids.asset}/original`;

  it('streams the whole file with its length, an ETag and byte ranges on offer', async () => {
    const { app } = await build(publicConfig());
    const response = await get(app, original);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ASSET_BYTES);
    expect(response.headers.get('content-length')).toBe(String(ASSET_BYTES.length));
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('etag')).toBe(`"sum-${ids.asset}"`);
  });

  it('answers a range with 206 and the part, and a suffix range from the end', async () => {
    const { app } = await build(publicConfig());
    const part = await get(app, original, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe(ASSET_BYTES.slice(2, 6));
    expect(part.headers.get('content-range')).toBe(`bytes 2-5/${ASSET_BYTES.length}`);
    expect(part.headers.get('content-length')).toBe('4');
    const tail = await get(app, original, { headers: { range: 'bytes=-3' } });
    expect(await tail.text()).toBe(ASSET_BYTES.slice(-3));
    const open = await get(app, original, { headers: { range: 'bytes=6-' } });
    expect(await open.text()).toBe(ASSET_BYTES.slice(6));
  });

  it('refuses a range past the end with 416, and ignores other units or several ranges', async () => {
    const { app } = await build(publicConfig());
    const past = await get(app, original, { headers: { range: `bytes=${ASSET_BYTES.length}-` } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe(`bytes */${ASSET_BYTES.length}`);
    for (const range of ['items=0-1', 'bytes=0-1,4-5']) {
      const whole = await get(app, original, { headers: { range } });
      expect(whole.status, range).toBe(200);
      expect(await whole.text()).toBe(ASSET_BYTES);
    }
  });

  it('answers a matching If-None-Match with 304, and If-Range with the whole file when stale', async () => {
    const { app } = await build(publicConfig());
    const etag = `"sum-${ids.asset}"`;
    const cached = await get(app, original, { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);
    const stale = await get(app, original, {
      headers: { range: 'bytes=0-1', 'if-range': '"old"' },
    });
    expect(stale.status).toBe(200);
    const current = await get(app, original, { headers: { range: 'bytes=0-1', 'if-range': etag } });
    expect(current.status).toBe(206);
  });
});
