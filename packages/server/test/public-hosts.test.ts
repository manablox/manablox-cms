import {
  type ControlScope,
  DefaultControls,
  defineContentType,
  type FeatureKey,
  type RequestServed,
  type ResolvedControls,
  type ResolvedFeature,
} from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

type App = Awaited<ReturnType<typeof createApp>>;

const unpinned = async (config: Record<string, unknown> = {}) => {
  const built = stubRuntime({ server: { mode: 'public' }, ...config });
  await initialised(built.runtime);
  return built;
};

const request = (app: App, path: string, host = 'public.test', init: RequestInit = {}) =>
  app.request(new Request(`http://${host}${path}`, init));

const graphql = (app: App, host: string, query: string) =>
  request(app, '/graphql', host, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });

/** The error's key, from the JSON or the GraphQL shape. */
const errorOf = async (response: Response) => {
  const body = (await response.json()) as {
    error?: { key: string; kind: string };
    errors?: Array<{ extensions: { key: string; kind: string } }>;
  };
  return body.error ?? body.errors?.[0]?.extensions;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('public instance with no pin and no API hosts', () => {
  it('answers 503 publicApi.space.unresolved with several spaces, and warns once', async () => {
    const { runtime } = await unpinned();
    const warn = vi.spyOn(runtime.manablox.logger, 'warn');
    const app = await createApp(runtime);

    for (const path of ['/', '/v1/content', '/graphql', '/readyz']) {
      const response = await request(app, path);
      expect(response.status).toBe(503);
      expect(await errorOf(response)).toMatchObject({
        key: 'publicApi.space.unresolved',
        kind: 'unavailable',
      });
    }
    expect((await request(app, '/healthz')).status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ spaces: 2 }, expect.stringMatching(/no space to serve/));
  });

  it('answers the 503 and its preflight with the public CORS headers', async () => {
    const { runtime } = await unpinned();
    const app = await createApp(runtime);
    const origin = 'https://site.test';

    const response = await request(app, '/v1/content', 'public.test', { headers: { origin } });
    expect(response.status).toBe(503);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    const preflight = await request(app, '/graphql', 'public.test', {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('picks the only space at most every ten seconds and keeps it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { runtime } = await unpinned();
    const app = await createApp(runtime);
    expect((await request(app, '/')).status).toBe(503);

    const spaces = runtime.repos.spaces as { list: () => Promise<Array<{ id: string }>> };
    const all = await spaces.list();
    spaces.list = async () => all.filter((space) => space.id === ids.otherSpace);
    // Too soon for another pick.
    expect((await request(app, '/')).status).toBe(503);

    vi.advanceTimersByTime(10_000);
    const response = await request(app, '/', 'anything.test');
    expect(response.status).toBe(200);
    expect(((await response.json()) as { space: string }).space).toBe(ids.otherSpace);

    // Kept, like a pin, when a second space shows up.
    spaces.list = async () => all;
    expect(((await (await request(app, '/')).json()) as { space: string }).space).toBe(
      ids.otherSpace,
    );
  });
});

describe('public instance resolving spaces by API host', () => {
  const twoHosts = async (config: Record<string, unknown> = {}) => {
    const built = await unpinned(config);
    built.calls.apiHosts.set('api.one.test', ids.space);
    built.calls.apiHosts.set('api.two.test', ids.otherSpace);
    return { ...built, app: await createApp(built.runtime) };
  };

  it('serves each space on its own host over REST and GraphQL', async () => {
    const { app, calls } = await twoHosts();

    const one = await request(app, '/', 'api.one.test');
    expect(((await one.json()) as { space: string }).space).toBe(ids.space);
    const two = await request(app, '/', 'API.Two.test:3100');
    expect(((await two.json()) as { space: string }).space).toBe(ids.otherSpace);

    expect((await request(app, '/v1/content?limit=1', 'api.one.test')).status).toBe(200);
    expect((await request(app, '/v1/content?limit=1', 'api.two.test')).status).toBe(200);
    expect(calls.listFilters.map((filter) => filter.spaceId)).toEqual([ids.space, ids.otherSpace]);

    const query = '{ contentsPage(limit: 1) { items { id } } }';
    expect((await graphql(app, 'api.one.test', query)).status).toBe(200);
    expect((await graphql(app, 'api.two.test', query)).status).toBe(200);
    expect(calls.listFilters.slice(2).map((filter) => filter.spaceId)).toEqual([
      ids.space,
      ids.otherSpace,
    ]);
  });

  it('answers 404 publicApi.host.unknown on other hosts; health and readiness stay up', async () => {
    const { app } = await twoHosts();
    for (const path of ['/', '/v1/content', '/graphql']) {
      const response = await request(app, path, 'unknown.test');
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toMatchObject({ key: 'publicApi.host.unknown' });
    }
    expect((await request(app, '/healthz', 'unknown.test')).status).toBe(200);
    expect((await request(app, '/readyz', '127.0.0.1:3100')).status).not.toBe(404);
  });

  it('keeps cached responses apart per host', async () => {
    const { app, calls, runtime } = await twoHosts();
    const cache = runtime.cache as unknown as { entries: Map<string, unknown> };
    const query = '{ contentsPage(limit: 1) { items { id } } }';

    await graphql(app, 'api.one.test', query);
    await graphql(app, 'api.two.test', query);
    await graphql(app, 'api.one.test', query);
    await request(app, '/v1/content?limit=1', 'api.one.test');
    await request(app, '/v1/content?limit=1', 'api.two.test');
    await request(app, '/v1/content?limit=1', 'api.two.test');

    // One miss per space and surface; the repeats are hits.
    expect(calls.listFilters.map((filter) => filter.spaceId)).toEqual([
      ids.space,
      ids.otherSpace,
      ids.space,
      ids.otherSpace,
    ]);
    const keys = [...cache.entries.keys()];
    expect(keys.filter((key) => key.startsWith(`gql:${ids.space}:`))).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith(`gql:${ids.otherSpace}:`))).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith(`rest:${ids.space}:`))).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith(`rest:${ids.otherSpace}:`))).toHaveLength(1);
  });

  it('meters and rate-limits by the resolved space', async () => {
    const space: ControlScope = { kind: 'space', id: ids.otherSpace };
    const { app, runtime } = await twoHosts({ cache: { enabled: false } });
    runtime.manablox.setControls(new SpaceRule(ids.otherSpace, space));
    const seen: RequestServed[] = [];
    runtime.manablox.hooks.on('request:served', (payload) => {
      seen.push(payload);
    });

    const served = await request(app, '/v1/content?limit=1', 'api.two.test');
    await served.arrayBuffer();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ surface: 'delivery', spaceId: ids.otherSpace });

    // The rule of space two applies only on its host.
    const refused = await request(app, '/v1/content?limit=1', 'api.two.test');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({
      error: { details: [{ params: { rule: 'delivery.space' } }] },
    });
    expect((await request(app, '/v1/content?limit=1', 'api.one.test')).status).toBe(200);
  });

  it('keeps a host resolution with the cache on, and none with it off', async () => {
    // A host moved without the purge an API host write sends: only a kept one stays.
    for (const [enabled, space] of [
      [true, ids.space],
      [false, ids.otherSpace],
    ] as const) {
      const { app, calls } = await twoHosts({ cache: { enabled } });
      const spaceOf = async () =>
        ((await (await request(app, '/', 'api.one.test')).json()) as { space: string }).space;
      expect(await spaceOf()).toBe(ids.space);
      calls.apiHosts.set('api.one.test', ids.otherSpace);
      expect(await spaceOf()).toBe(space);
    }
  });

  it('gates features by the resolved space', async () => {
    const { app, runtime } = await twoHosts();
    runtime.manablox.setControls(new RestOff(ids.otherSpace));
    expect((await request(app, '/v1/content', 'api.one.test')).status).toBe(200);
    expect((await request(app, '/v1/content', 'api.two.test')).status).toBe(404);
  });
});

describe('public instance pinned by id', () => {
  it('serves the pin on every host, API hosts or not', async () => {
    const { runtime, calls } = await unpinned({ publicApi: { spaceId: ids.otherSpace } });
    calls.apiHosts.set('api.one.test', ids.space);
    const app = await createApp(runtime);
    for (const host of ['api.one.test', 'unknown.test']) {
      const response = await request(app, '/', host);
      expect(((await response.json()) as { space: string }).space).toBe(ids.otherSpace);
    }
  });

  it('starts when another space declares a type of the same name', async () => {
    const { runtime, manablox } = stubRuntime({
      server: { mode: 'public' },
      publicApi: { spaceId: ids.space },
    });
    for (const spaceId of [ids.space, ids.otherSpace]) {
      manablox.contentTypes.add(
        defineContentType({ name: 'article', spaceId, fields: [{ name: 'body', type: 'string' }] }),
      );
    }
    await initialised(runtime);
    const app = await createApp(runtime);

    const response = await graphql(app, 'public.test', '{ __typename }');
    expect(response.status).toBe(200);
  });
});

/** One `delivery.space` request a minute in `spaceId`. */
class SpaceRule extends DefaultControls {
  constructor(
    private readonly spaceId: string,
    private readonly scope: ControlScope,
  ) {
    super();
  }

  override async resolved(spaceId: string | null): Promise<ResolvedControls> {
    const base = await super.resolved(spaceId);
    if (spaceId !== this.spaceId) return base;
    return {
      ...base,
      rateLimits: { ...base.rateLimits, 'delivery.space': { max: 1, windowSeconds: 60 } },
      rateLimitScopes: { ...base.rateLimitScopes, 'delivery.space': this.scope },
    };
  }
}

/** `restDelivery` off in `spaceId`. */
class RestOff extends DefaultControls {
  constructor(private readonly spaceId: string) {
    super();
  }

  override async feature(spaceId: string | null, key: FeatureKey): Promise<ResolvedFeature> {
    const base = await super.feature(spaceId, key);
    return spaceId === this.spaceId && key === 'restDelivery' ? { ...base, enabled: false } : base;
  }
}
