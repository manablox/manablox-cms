import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

const build = async () => {
  const { runtime, calls } = stubRuntime({
    server: { mode: 'public' as const },
    publicApi: { spaceId: ids.space },
    cache: { enabled: false },
    contentTypes: [
      {
        name: 'page',
        fields: [
          { name: 'summary', type: 'string' },
          {
            name: 'latest',
            type: 'content',
            settings: { multiple: true, selection: 'filter', limit: 3 },
          },
          {
            name: 'gallery',
            type: 'asset',
            settings: { multiple: true, selection: 'filter', limit: 2 },
          },
        ],
      },
    ],
  });
  await initialised(runtime);
  return { app: await createApp(runtime), calls };
};

describe('graphql filter relations', () => {
  it('runs each relation query once per request, not once per parent row', async () => {
    const { app, calls } = await build();
    const response = await app.request(
      new Request('http://public.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query:
            '{ contentsPage(limit: 5) { items { id ... on Page { latest { id } gallery { id } } } } }',
        }),
      }),
    );
    const body = (await response.json()) as {
      data?: { contentsPage: { items: Array<{ latest: unknown[]; gallery: unknown[] }> } };
      errors?: unknown;
    };

    expect(body.errors).toBeUndefined();
    expect(body.data?.contentsPage.items).toHaveLength(5);
    expect(body.data?.contentsPage.items[4]?.latest).toHaveLength(3);
    expect(body.data?.contentsPage.items[4]?.gallery).toHaveLength(1);
    // One for the root list, one for `latest`.
    expect(calls.queries.filter((query) => query === 'content.page')).toHaveLength(2);
    expect(calls.queries.filter((query) => query === 'assets.page')).toHaveLength(1);
  });

  it('sends an ETag with caching off', async () => {
    const { app } = await build();
    const response = await app.request(
      new Request('http://public.test/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ contentsPage(limit: 1) { items { id } } }' }),
      }),
    );
    expect(response.headers.get('etag')).toMatch(/^W\/"[A-Za-z0-9_-]{16}-[0-9a-f]+"$/);
    expect(await response.json()).toEqual({ data: { contentsPage: { items: [{ id: 'c0' }] } } });
  });
});
