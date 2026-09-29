import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

type App = Awaited<ReturnType<typeof createApp>>;

interface GraphQLBody {
  data?: unknown;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

const build = async (mode: 'public' | 'management', breakList = false, signed = true) => {
  const { runtime } = stubRuntime(
    mode === 'public'
      ? { server: { mode: 'public' as const }, publicApi: { spaceId: ids.space } }
      : {},
  );
  await initialised(runtime);
  if (!signed) (runtime.media as { verify: unknown }).verify = () => false;
  if (breakList) {
    (runtime.repos.content as { page: unknown }).page = async () => {
      throw new Error('connection to db-internal-7 refused');
    };
  }
  return createApp(runtime, mode === 'management' ? { spaceId: ids.space } : {});
};

const get = (app: App, path: string, headers: Record<string, string> = {}) =>
  app.request(new Request(`http://api.test${path}`, { headers }));

const SPEC = 'application/graphql-response+json';

const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(
    new Request(`http://api.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

/** A management app whose one public procedure fails unexpectedly. */
const brokenManagement = async () => {
  const { runtime } = stubRuntime({});
  await initialised(runtime);
  (runtime as unknown as { users: unknown }).users = {
    setupNeeded: async () => {
      throw new Error('connection to db-internal-7 refused');
    },
  };
  const logged = vi.spyOn(runtime.manablox.logger, 'error');
  return { app: await createApp(runtime, { spaceId: ids.space }), logged };
};

const graphql = async (app: App, query: string): Promise<GraphQLBody> => {
  const response = await app.request(
    new Request('http://api.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-manablox-space': ids.space },
      body: JSON.stringify({ query }),
    }),
  );
  return (await response.json()) as GraphQLBody;
};

describe('public REST errors', () => {
  it('answers a 404 with the transport shape', async () => {
    const app = await build('public');
    const response = await get(app, '/v1/content/22222222-2222-4222-8222-222222222222');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        key: 'content.notFound',
        kind: 'not_found',
        status: 404,
        message: 'content.notFound',
        details: [
          { key: 'content.notFound', params: { id: '22222222-2222-4222-8222-222222222222' } },
        ],
      },
    });
  });

  it('answers an unknown type with contentType.notFound', async () => {
    const app = await build('public');
    const response = await get(app, '/v1/content?type=nope');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { key: string; kind: string } };
    expect(body.error).toMatchObject({ key: 'contentType.notFound', kind: 'not_found' });
  });

  it('answers invalid input with a 422 and a detail per issue', async () => {
    const app = await build('public');
    const response = await get(app, '/v1/content?limit=1000');

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: {
        key: string;
        kind: string;
        status: number;
        details: Array<{ key: string; path: unknown[]; params: Record<string, unknown> }>;
      };
    };
    expect(body.error).toMatchObject({ key: 'validation.failed', kind: 'validation', status: 422 });
    expect(body.error.details).toEqual([
      expect.objectContaining({
        key: 'validation.invalid',
        path: ['limit'],
        params: expect.objectContaining({ code: 'too_big', maximum: 100 }),
      }),
    ]);
  });

  it('answers a bad media signature with the transport shape', async () => {
    const app = await build('public', false, false);
    const response = await get(app, `/media/${ids.asset}/thumb.webp?s=forged`);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { key: 'media.signature.invalid', kind: 'forbidden', status: 403 },
    });
  });
});

describe('GraphQL errors', () => {
  it('keeps the key of an unknown type on a masked public instance', async () => {
    const app = await build('public');
    const body = await graphql(app, '{ contentsPage(type: "nope") { items { id } } }');

    expect(body.errors?.[0]).toMatchObject({
      message: 'contentType.notFound',
      extensions: { key: 'contentType.notFound', kind: 'not_found', status: 404 },
    });
    expect(body.errors?.[0]?.extensions?.details).toEqual([
      { key: 'contentType.notFound', params: { name: 'nope', spaceId: ids.space } },
    ]);
  });

  it('keeps the key on an unmasked management instance', async () => {
    const app = await build('management');
    const body = await graphql(app, '{ contentsPage(type: "nope") { items { id } } }');

    expect(body.errors?.[0]?.extensions).toMatchObject({ key: 'contentType.notFound' });
  });

  it('still masks an unexpected error on a public instance', async () => {
    const app = await build('public', true);
    const body = await graphql(app, '{ contentsPage { items { id } } }');

    expect(body.errors?.[0]?.message).toBe('Unexpected error.');
    expect(body.errors?.[0]?.extensions).not.toHaveProperty('key');
    expect(JSON.stringify(body)).not.toContain('db-internal-7');
  });

  it('never leaks an unexpected error over public REST', async () => {
    const app = await build('public', true);
    const response = await get(app, '/v1/content');

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('db-internal-7');
    expect(JSON.parse(text)).toMatchObject({
      error: { key: 'internal.error', kind: 'internal', status: 500, details: [] },
    });
  });
});

describe('not found', () => {
  it('answers an unmatched API path with route.notFound', async () => {
    const app = await build('management');
    for (const path of ['/nope', '/api/v1/nope', '/rpc/nope']) {
      const response = await get(app, path, { accept: 'application/json' });
      expect(response.status, path).toBe(404);
      expect(await response.json(), path).toMatchObject({
        error: { key: 'route.notFound', kind: 'not_found', status: 404 },
      });
    }
    // API paths answer JSON without asking.
    expect(await (await get(app, '/v1/nope')).json()).toMatchObject({
      error: { key: 'route.notFound' },
    });
  });

  it('keeps plain text for browsers and media loads', async () => {
    const app = await build('public');
    const page = await get(app, '/nope', { accept: 'text/html' });
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toContain('text/plain');

    const image = await get(app, '/media/33333333-3333-4333-8333-333333333333/original', {
      accept: 'image/avif,image/webp,*/*',
    });
    expect(image.status).toBe(404);
    expect(await image.text()).toBe('404 Not Found');
  });

  it('answers a missing asset with asset.notFound to JSON clients', async () => {
    const app = await build('public');
    const response = await get(app, '/media/33333333-3333-4333-8333-333333333333/original', {
      accept: 'application/json',
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        key: 'asset.notFound',
        details: [
          { key: 'asset.notFound', params: { id: '33333333-3333-4333-8333-333333333333' } },
        ],
      },
    });
  });
});

describe('unexpected management errors', () => {
  it('answers internal.error over RPC and logs the cause', async () => {
    const { app, logged } = await brokenManagement();
    const response = await post(app, '/rpc/users/setupNeeded', {});

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('db-internal-7');
    expect(JSON.parse(text).json).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      data: { key: 'internal.error', kind: 'internal', status: 500, details: [] },
    });
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), procedure: 'users.setupNeeded' }),
      'unhandled error',
    );
  });

  it('answers internal.error over /api/v1', async () => {
    const { app, logged } = await brokenManagement();
    const response = await post(app, '/api/v1/users/setupNeeded', {});

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        key: 'internal.error',
        kind: 'internal',
        status: 500,
        message: 'Internal server error.',
        details: [],
      },
    });
    expect(logged).toHaveBeenCalledOnce();
  });

  it('keeps expected errors unlogged and keyed', async () => {
    const { app, logged } = await brokenManagement();
    const response = await post(app, '/rpc/users/list', {});

    expect(response.status).toBe(401);
    expect(JSON.parse(await response.text()).json.data).toMatchObject({
      key: 'auth.unauthorized',
    });
    expect(logged).not.toHaveBeenCalled();
  });
});

describe('OpenAPI error responses', () => {
  type Document = {
    paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    components: { schemas: Record<string, unknown>; responses: Record<string, unknown> };
  };

  it.each(['management', 'public'] as const)(
    'declares them on every %s operation',
    async (mode) => {
      const app = await build(mode);
      const document = (await (await get(app, '/openapi.json')).json()) as Document;

      expect(document.components.schemas.Error).toMatchObject({ required: ['error'] });
      expect(document.components.responses.Error404).toMatchObject({
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      });
      const operations = Object.values(document.paths).flatMap((item) => Object.values(item));
      expect(operations.length).toBeGreaterThan(0);
      for (const operation of operations) {
        for (const status of ['400', '401', '403', '404', '409', '422', '429', '500']) {
          expect(operation.responses[status]).toEqual({
            $ref: `#/components/responses/Error${status}`,
          });
        }
        expect(operation.responses['200']).toBeDefined();
      }
    },
  );
});

describe('GraphQL HTTP status', () => {
  const deep = `{ contentsPage { items { ${'parent { '.repeat(10)}id${' }'.repeat(10)} } } }`;

  it('answers a query past the depth limit 400 under graphql-response+json', async () => {
    const app = await build('public');
    const response = await post(app, '/graphql', { query: deep }, { accept: SPEC });

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain(SPEC);
    const body = (await response.json()) as GraphQLBody;
    expect(body.data).toBeUndefined();
    expect(body.errors?.[0]?.extensions).toMatchObject({
      code: 'QUERY_TOO_DEEP',
      key: 'graphql.query.tooDeep',
      kind: 'bad_request',
    });
  });

  it('keeps 200 for the same refusal under plain application/json', async () => {
    const app = await build('public');
    const response = await post(app, '/graphql', { query: deep }, { accept: 'application/json' });

    expect(response.status).toBe(200);
    expect(((await response.json()) as GraphQLBody).errors?.[0]?.extensions?.code).toBe(
      'QUERY_TOO_DEEP',
    );
  });

  it('answers a field error 200', async () => {
    const app = await build('management');
    const response = await post(
      app,
      '/graphql',
      { query: '{ contentsPage(type: "nope") { items { id } } }' },
      { accept: SPEC, 'x-manablox-space': ids.space },
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as GraphQLBody).errors?.[0]?.extensions).toMatchObject({
      key: 'contentType.notFound',
    });
  });

  it('answers an unknown space 404 in the GraphQL shape', async () => {
    const app = await build('management');
    const response = await post(
      app,
      '/graphql',
      { query: '{ contentsPage { items { id } } }' },
      { 'x-manablox-space': '44444444-4444-4444-8444-444444444444' },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      errors: [
        {
          message: 'space.notFound',
          extensions: {
            key: 'space.notFound',
            kind: 'not_found',
            status: 404,
            details: [
              {
                key: 'space.notFound',
                params: { spaceId: '44444444-4444-4444-8444-444444444444' },
              },
            ],
          },
        },
      ],
    });
  });

  it('answers the rate limit 429 in the GraphQL shape', async () => {
    const { runtime } = stubRuntime({
      server: { mode: 'public' as const },
      publicApi: { spaceId: ids.space, rateLimit: { window: 60_000, max: 1 } },
    } as never);
    await initialised(runtime);
    const app = await createApp(runtime);
    const query = { query: '{ contentsPage { items { id } } }' };

    expect((await post(app, '/graphql', query)).status).toBe(200);
    const refused = await post(app, '/graphql', query, { accept: SPEC });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-type')).toContain(SPEC);
    expect(((await refused.json()) as GraphQLBody).errors?.[0]).toMatchObject({
      message: 'rateLimit.exceeded',
      extensions: { key: 'rateLimit.exceeded', kind: 'rate_limited', status: 429 },
    });
  });
});
