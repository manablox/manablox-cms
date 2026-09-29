import type { RequestServed } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ASSET_BYTES, initialised, stubRuntime } from './helpers/runtime.js';

const build = async (config: Record<string, unknown> = {}) => {
  const { runtime } = stubRuntime({
    server: { mode: 'public' as const },
    publicApi: { spaceId: ids.space },
    ...config,
  });
  await initialised(runtime);
  const seen: RequestServed[] = [];
  runtime.manablox.hooks.on('request:served', (payload) => {
    seen.push(payload);
  });
  return { app: await createApp(runtime), seen };
};

type App = Awaited<ReturnType<typeof createApp>>;

const get = (app: App, path: string, headers: Record<string, string> = {}) =>
  app.request(new Request(`http://public.test${path}`, { headers }));

const graphql = (app: App, query: string) =>
  app.request(
    new Request('http://public.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    }),
  );

describe('request:served', () => {
  it('reports a REST delivery response once its body was read, then a cached 304', async () => {
    const { app, seen } = await build();
    const response = await get(app, '/v1/content?limit=1');
    const body = await response.arrayBuffer();

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      surface: 'delivery',
      spaceId: ids.space,
      status: 200,
      bytes: body.byteLength,
      cached: false,
    });
    expect(body.byteLength).toBeGreaterThan(0);

    const etag = response.headers.get('etag') ?? '';
    const again = await get(app, '/v1/content?limit=1', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toMatchObject({ surface: 'delivery', status: 304, bytes: 0, cached: true });
  });

  it('reports GraphQL delivery', async () => {
    const { app, seen } = await build();
    const response = await graphql(app, '{ __typename }');
    const body = await response.arrayBuffer();

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({
      surface: 'delivery',
      spaceId: ids.space,
      status: 200,
      bytes: body.byteLength,
    });
  });

  it('reports media with the content length', async () => {
    const { app, seen } = await build();
    const response = await get(app, `/media/${ids.asset}/original`);
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({
      surface: 'media',
      spaceId: ids.space,
      status: 200,
      bytes: ASSET_BYTES.length,
      cached: false,
    });
  });

  it('leaves responses untouched while no handler listens', async () => {
    const { runtime } = stubRuntime({
      server: { mode: 'public' as const },
      publicApi: { spaceId: ids.space },
    });
    await initialised(runtime);
    const app = await createApp(runtime);
    const observe = vi.spyOn(runtime.manablox.hooks, 'observe');
    const response = await get(app, '/v1/content?limit=1');
    await response.arrayBuffer();
    expect(observe).not.toHaveBeenCalled();
  });
});
