import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type ManabloxClientOptions } from '../src/client.js';
import { ManabloxGraphQLError, ManabloxHttpError, ManabloxTimeoutError } from '../src/errors.js';

const CONTENT = {
  id: 'c1',
  type: 'page',
  title: 'About',
  slug: 'about',
  permalink: 'about',
  locale: 'en',
  parentId: null,
  publishedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  fields: {
    summary: 'Hello',
    hero: 'a1',
    components: {
      grid: null,
      blocks: [
        {
          blockId: 'b1',
          type: 'teaser',
          fields: { headline: 'A teaser' },
          design: { variant: 'dark' },
        },
      ],
    },
  },
};

const REDIRECT = {
  locale: null,
  fromPath: '/old',
  toPath: '/about',
  status: 301,
  contentId: 'c1',
};

/** One fetch stub answering both transports, so the suite runs unchanged against either. */
function stubFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);

    if (target.includes('/graphql')) {
      const body = JSON.parse(String(init?.body)) as { query: string };
      const node = {
        ...CONTENT,
        ...CONTENT.fields,
        // GraphQL blocks: flat fields and `typeName`.
        components: {
          grid: null,
          blocks: [
            {
              blockId: 'b1',
              typeName: 'teaser',
              headline: 'A teaser',
              design: { variant: 'dark' },
            },
          ],
        },
        fields: undefined,
        parentId: undefined,
      };
      delete (node as Record<string, unknown>).fields;
      delete (node as Record<string, unknown>).parentId;

      const data = body.query.includes('contentByPermalink')
        ? { contentByPermalink: node }
        : body.query.includes('contentsPage(')
          ? { contentsPage: { items: [node], total: 7, limit: 25, offset: 0 } }
          : body.query.includes('redirects(')
            ? { redirects: [REDIRECT] }
            : body.query.includes('menu(')
              ? {
                  menu: {
                    id: 'm1',
                    name: 'Main',
                    machineName: 'main',
                    items: [{ id: 'i1', label: 'Home', url: null, content: node, children: [] }],
                  },
                }
              : body.query.includes('asset(')
                ? { asset: { id: 'a1', url: 'https://cdn/a1', mimeType: 'image/jpeg' } }
                : { content: node };

      return json({ data });
    }

    if (/\/v1\/permalink(\/|\?|$)/.test(target)) return json(CONTENT);
    if (target.includes('/v1/content/')) return json(CONTENT);
    if (target.includes('/v1/content')) {
      return json({ items: [CONTENT], total: 1, limit: 25, offset: 0 });
    }
    if (target.includes('/v1/redirects')) return json({ items: [REDIRECT] });
    if (target.includes('/v1/menus/')) {
      return json({
        id: 'm1',
        name: 'Main',
        machineName: 'main',
        items: [{ id: 'i1', label: 'Home', url: null, content: CONTENT, children: [] }],
      });
    }
    if (target.includes('/v1/assets/')) {
      return json({ id: 'a1', url: 'https://cdn/a1', mimeType: 'image/jpeg' });
    }
    if (target.includes('/v1/types')) return json({ types: [] });

    return new Response('not found', { status: 404 });
  });
}

const json = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const client = (fetch: ReturnType<typeof stubFetch>, over: Partial<ManabloxClientOptions> = {}) =>
  createClient({
    url: 'https://cms.example.com/',
    fetch: fetch as unknown as typeof globalThis.fetch,
    cache: false,
    ...over,
  });

describe.each(['graphql', 'rest'] as const)('%s transport', (transport) => {
  let fetch: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    fetch = stubFetch();
  });

  // The stub delivers the website plugin's `design` on its block.
  const sdk = (over: Partial<ManabloxClientOptions> = {}) =>
    client(fetch, { transport, blockExtensions: ['design'], ...over });

  it("keeps a block's plugin data on the block, out of its fields", async () => {
    const page = await sdk().get('c1');
    const block = (page?.fields.components as { blocks: Record<string, unknown>[] }).blocks[0];
    expect(block?.design).toEqual({ variant: 'dark' });
    expect(block?.fields).toEqual({ headline: 'A teaser' });
    // The keys are named by the client option, none by default; REST needs none.
    const named = await client(fetch, { transport }).get('c1');
    const plain = (named?.fields.components as { blocks: Record<string, unknown>[] }).blocks[0];
    expect(plain?.fields).toEqual(
      transport === 'graphql'
        ? { headline: 'A teaser', design: { variant: 'dark' } }
        : { headline: 'A teaser' },
    );
  });

  it('resolves a permalink to a document', async () => {
    const page = await sdk().byPermalink('/about/');
    expect(page?.id).toBe('c1');
    expect(page?.title).toBe('About');
    expect(page?.type).toBe('page');
  });

  it('resolves the root path to the home page', async () => {
    const page = await sdk().byPermalink('/');
    expect(page?.id).toBe('c1');

    const [url, init] = fetch.mock.calls.at(-1) as [string, RequestInit | undefined];
    if (transport === 'rest') {
      // The bare route: the server cannot match an empty segment.
      expect(url).toMatch(/\/v1\/permalink(\?|$)/);
    } else {
      expect(JSON.parse(String(init?.body)).variables.permalink).toBe('');
    }
  });

  it('presents field values both flattened and under `fields`', async () => {
    const page = await sdk().byPermalink('about');
    expect(page?.summary).toBe('Hello');
    expect(page?.fields.summary).toBe('Hello');
  });

  it('presents blocks identically whichever transport served them', async () => {
    const page = await sdk().byPermalink('about');
    const blocks = (page?.fields.components as { blocks: Array<Record<string, unknown>> }).blocks;

    expect(blocks[0]?.type).toBe('teaser');
    expect(blocks[0]?.headline).toBe('A teaser');
    expect(blocks[0]?.fields).toEqual({ headline: 'A teaser' });
  });

  it('fetches by id', async () => {
    expect((await sdk().get('c1'))?.id).toBe('c1');
  });

  it('lists documents', async () => {
    const page = await sdk().list({ type: 'page', limit: 25 });
    expect(page.items[0]?.title).toBe('About');
    expect(page.limit).toBe(25);
    // The server's count, not a lower bound.
    expect(page.total).toBe(transport === 'graphql' ? 7 : 1);
  });

  it('fetches a menu by name, with each entry linkable', async () => {
    const menu = await sdk().menu('main');
    expect(menu?.items.length).toBe(1);
    expect(menu?.items[0]?.label).toBe('Home');
    expect(menu?.items[0]?.href).toBe(`/${CONTENT.permalink}`);
  });

  it('fetches the redirects of a locale', async () => {
    expect(await sdk().redirects({ locale: 'de' })).toEqual([REDIRECT]);
    const [url, init] = fetch.mock.calls.at(-1) as [string, RequestInit | undefined];
    if (transport === 'rest') expect(url).toMatch(/\/v1\/redirects\?locale=de$/);
    else expect(JSON.parse(String(init?.body)).variables.locale).toBe('de');
  });

  it('fetches an asset', async () => {
    expect((await sdk().asset('a1'))?.url).toBe('https://cdn/a1');
  });

  it('trims a trailing slash from the base URL', async () => {
    await sdk().get('c1');
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain('//v1');
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/^https:\/\/cms\.example\.com\/(v1|graphql)/);
  });
});

describe('rest transport specifics', () => {
  it('turns a 404 into null, and leaves a 500 as an error', async () => {
    const notFound = vi.fn(async () => new Response('{}', { status: 404 }));
    const broken = vi.fn(async () => new Response('{}', { status: 500 }));

    await expect(
      client(notFound as never, { transport: 'rest' }).byPermalink('missing'),
    ).resolves.toBeNull();

    await expect(
      client(broken as never, { transport: 'rest', retry: { attempts: 1 } }).byPermalink('x'),
    ).rejects.toBeInstanceOf(ManabloxHttpError);
  });

  it('reads the key and details of an error body', async () => {
    const body = {
      error: {
        key: 'validation.failed',
        kind: 'validation',
        status: 422,
        message: 'validation.failed',
        details: [{ key: 'validation.invalid', path: ['limit'], params: { maximum: 100 } }],
      },
    };
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 422 }));

    const error = await client(fetch as never, { transport: 'rest' })
      .list()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ManabloxHttpError);
    const http = error as ManabloxHttpError;
    expect(http.key).toBe('validation.failed');
    expect(http.error?.kind).toBe('validation');
    expect(http.details).toEqual(body.error.details);
    expect(http.message).toContain('validation.failed');
  });

  it('leaves the key unset for a body that is not an error envelope', () => {
    expect(new ManabloxHttpError(502, 'Bad Gateway', 'x', '<html>').key).toBeUndefined();
  });

  it('passes expand through as a query parameter', async () => {
    const fetch = stubFetch();
    await client(fetch, { transport: 'rest' }).list({}, { expand: ['hero', 'author'] });
    expect(String(fetch.mock.calls[0]?.[0])).toContain('expand=hero%2Cauthor');
  });
});

describe('graphql transport specifics', () => {
  it('merges a caller selection into the base selection', async () => {
    const fetch = stubFetch();
    await client(fetch, { transport: 'graphql' }).byPermalink('about', {
      selection: '... on Page { summary }',
    });
    const body = String((fetch.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain('type: typeName');
    expect(body).toContain('... on Page { summary }');
  });

  it('exposes the key of a GraphQL error', async () => {
    const fetch = vi.fn(async () =>
      json({
        data: null,
        errors: [
          {
            message: 'contentType.notFound',
            extensions: {
              key: 'contentType.notFound',
              kind: 'not_found',
              status: 404,
              details: [],
            },
          },
        ],
      }),
    );

    const error = await client(fetch as never, { transport: 'graphql' })
      .query('{ contentsPage(type: "nope") { items { id } } }')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ManabloxGraphQLError);
    expect((error as ManabloxGraphQLError).key).toBe('contentType.notFound');
  });

  it('reads a refused request as a GraphQL error with its status', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                message: 'Query exceeds the maximum depth of 8',
                extensions: {
                  code: 'QUERY_TOO_DEEP',
                  key: 'graphql.query.tooDeep',
                  kind: 'bad_request',
                  status: 400,
                  maxDepth: 8,
                  details: [{ key: 'graphql.query.tooDeep', params: { maxDepth: 8 } }],
                },
              },
            ],
          }),
          { status: 400, headers: { 'content-type': 'application/graphql-response+json' } },
        ),
    );

    const error = await client(fetch as never, { transport: 'graphql' })
      .query('{ contentsPage { items { id } } }')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ManabloxGraphQLError);
    expect(error).toMatchObject({
      status: 400,
      code: 'QUERY_TOO_DEEP',
      key: 'graphql.query.tooDeep',
    });
    const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers;
    expect((headers as Record<string, string>).accept).toContain(
      'application/graphql-response+json',
    );
  });

  it('keeps a non-GraphQL failure an HTTP error', async () => {
    const fetch = vi.fn(async () => new Response('bad gateway', { status: 502 }));

    const error = await client(fetch as never, {
      transport: 'graphql',
      retry: { attempts: 1 },
    })
      .query('{ contentsPage { items { id } } }')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ManabloxHttpError);
  });

  it('refuses client.query() on the rest transport', () => {
    expect(() => client(stubFetch(), { transport: 'rest' }).query('{ ok }')).toThrow(
      /requires the graphql transport/,
    );
  });
});

describe('resilience', () => {
  it('retries a 5xx and succeeds', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response('{}', { status: 503 })
        : json({ items: [CONTENT], total: 1, limit: 25, offset: 0 });
    });

    const page = await client(fetch as never, {
      transport: 'rest',
      retry: { attempts: 3, baseDelay: 1 },
    }).list();

    expect(calls).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      return new Response('{}', { status: 400 });
    });

    await expect(
      client(fetch as never, { transport: 'rest', retry: { attempts: 3, baseDelay: 1 } }).list(),
    ).rejects.toBeInstanceOf(ManabloxHttpError);
    expect(calls).toBe(1);
  });

  it('honours Retry-After rather than its own backoff', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      return calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
        : json({ items: [], total: 0, limit: 25, offset: 0 });
    });

    await client(fetch as never, {
      transport: 'rest',
      retry: { attempts: 2, baseDelay: 10_000 },
    }).list();
    expect(calls).toBe(2);
  });

  it('times out rather than hanging', async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    await expect(
      client(fetch as never, {
        transport: 'rest',
        timeout: 10,
        retry: { attempts: 1 },
      }).list(),
    ).rejects.toBeInstanceOf(ManabloxTimeoutError);
  });

  it("propagates the caller's abort signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    const pending = client(fetch as never, { transport: 'rest', timeout: 0 }).list(
      {},
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/);
  });
});

describe('deduplication and cache', () => {
  it('serves two simultaneous identical calls from one request', async () => {
    const fetch = stubFetch();
    const sdk = client(fetch, { transport: 'rest', cache: { ttl: 0 } });

    const [a, b] = await Promise.all([sdk.menu('main'), sdk.menu('main')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('reuses a cached answer within the TTL and refetches after `fresh`', async () => {
    const fetch = stubFetch();
    const sdk = client(fetch, { transport: 'rest', cache: { ttl: 10_000 } });

    await sdk.menu('main');
    await sdk.menu('main');
    expect(fetch).toHaveBeenCalledTimes(1);

    await sdk.menu('main', { fresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let a per-call abort signal defeat deduplication', async () => {
    const fetch = stubFetch();
    const sdk = client(fetch, { transport: 'rest', cache: { ttl: 10_000 } });

    await sdk.menu('main', { signal: new AbortController().signal });
    await sdk.menu('main', { signal: new AbortController().signal });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keys separately per transport', async () => {
    const fetch = stubFetch();
    await client(fetch, { transport: 'rest', cache: { ttl: 10_000 } }).menu('main');
    await client(fetch, { transport: 'graphql', cache: { ttl: 10_000 } }).menu('main');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
