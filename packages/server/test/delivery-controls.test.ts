import { DefaultControls, type FeatureKey, type ResolvedFeature } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { initialised, stubRuntime } from './helpers/runtime.js';

const LOCKED = { message: 'Upgrade to unlock', link: 'https://example.com/upgrade' };

/** Catalogue defaults with `off` switched off in `spaceId`. */
class ControlsWith extends DefaultControls {
  constructor(
    private readonly off: FeatureKey[],
    private readonly spaceId: string | null,
  ) {
    super();
  }

  override async feature(space: string | null, key: FeatureKey): Promise<ResolvedFeature> {
    const base = await super.feature(space, key);
    if (!this.off.includes(key) || space !== this.spaceId) return base;
    return { ...base, enabled: false, ...LOCKED };
  }
}

const build = async (
  off: FeatureKey[],
  offIn: string | null,
  config: Record<string, unknown> = {},
) => {
  const { runtime, manablox } = stubRuntime(config);
  await initialised(runtime);
  manablox.setControls(new ControlsWith(off, offIn));
  // Every presented key is a reader of the space.
  (runtime.apiKeys as unknown as { resolve: unknown }).resolve = async () => ({
    userId: ids.user,
    email: 'key@example.com',
    role: 'editor',
    spaces: { [ids.space]: 'viewer' },
  });
  return createApp(runtime);
};

type App = Awaited<ReturnType<typeof build>>;

const publicConfig = (spaceId = ids.space) => ({
  server: { mode: 'public' as const },
  publicApi: { spaceId },
  cache: { enabled: false },
});

const graphql = (app: App, headers: Record<string, string> = {}) =>
  app.request(
    new Request('http://api.test/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query: '{ contentsPage { items { id } } }' }),
    }),
  );

const rest = (app: App) => app.request(new Request('http://api.test/v1/content'));

describe('delivery switches', () => {
  it('answers 404 on public GraphQL while graphqlDelivery is off for the pinned space', async () => {
    const app = await build(['graphqlDelivery'], ids.space, publicConfig());
    expect((await graphql(app)).status).toBe(404);
    expect((await rest(app)).status).toBe(200);
  });

  it('answers 404 on REST while restDelivery is off for the pinned space', async () => {
    const app = await build(['restDelivery'], ids.space, publicConfig());
    expect((await rest(app)).status).toBe(404);
    expect((await graphql(app)).status).toBe(200);
  });

  it('keeps serving a space the switch does not cover', async () => {
    const app = await build(
      ['graphqlDelivery', 'restDelivery'],
      ids.otherSpace,
      publicConfig(ids.space),
    );
    expect((await graphql(app)).status).toBe(200);
    expect((await rest(app)).status).toBe(200);
  });
});

describe('visualEditor', () => {
  it('refuses preview reads on the management API with the feature error', async () => {
    const app = await build(['visualEditor'], ids.space);
    const response = await graphql(app, {
      'x-api-key': 'key',
      'x-manablox-preview': '1',
      'x-manablox-space': ids.space,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      errors: [
        {
          extensions: {
            key: 'control.feature',
            details: [{ params: { feature: 'visualEditor', ...LOCKED } }],
          },
        },
      ],
    });

    // Published reads of the same space still pass.
    expect((await graphql(app, { 'x-manablox-space': ids.space })).status).toBe(200);
  });

  it('allows preview reads while it is on', async () => {
    const app = await build(['visualEditor'], ids.otherSpace);
    const response = await graphql(app, {
      'x-api-key': 'key',
      'x-manablox-preview': '1',
      'x-manablox-space': ids.space,
    });
    expect(response.status).toBe(200);
  });
});
