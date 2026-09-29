import { MemoryCache } from '@manablox/cache';
import {
  definePlugin,
  type FeatureCeilingProvider,
  type FeatureControl,
  type FeatureKey,
  type ManabloxConfig,
} from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ControlService, ControlStore } from '../src/controls/index.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let counter = 0;

beforeAll(async () => {
  ctx = await createServiceContext('ceilings', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});
beforeEach(async () => {
  for (const row of await ctx.repos.controlSettings.listAll()) {
    await ctx.repos.controlSettings.delete({ kind: row.scopeKind, id: row.scopeId }, row.key);
  }
  ctx.controlStore.forget(null);
});

const freshSpace = async () => {
  const name = `ceil-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://c.test' })).id;
};

const locked: FeatureControl = {
  enabled: false,
  presentation: 'locked',
  message: 'Needs a license',
  link: 'https://buy.test',
};

/** A provider whose values a test sets, moving its version. */
function provider() {
  let version = 0;
  let current = new Map<FeatureKey, FeatureControl>();
  return {
    features: () => current,
    version: () => version,
    set(next: Record<string, FeatureControl>) {
      current = new Map(Object.entries(next)) as Map<FeatureKey, FeatureControl>;
      version++;
    },
  } satisfies FeatureCeilingProvider & { set(next: Record<string, FeatureControl>): void };
}

/** Another process: its own runtime and ceilings, the same database and shared cache. */
function processWith(shared: MemoryCache) {
  const manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test' },
    fieldTypes: [],
    contentTypes: [],
    plugins: [definePlugin({ name: 'capped' })],
    logLevel: 'silent',
  } as unknown as ManabloxConfig);
  const store = new ControlStore(manablox, ctx.repos, { shared });
  manablox.setControls(store);
  return { manablox, store, controls: new ControlService(manablox, ctx.repos, store) };
}

describe('feature ceilings in the control store', () => {
  it('win over an instance, group and space all set on, with their message and link', async () => {
    const { manablox, store, controls } = processWith(new MemoryCache(5));
    const ceiling = provider();
    manablox.ceilings.add(ceiling);
    ceiling.set({ approvals: locked });
    const spaceId = await freshSpace();
    const group = await controls.createGroup({ name: `Ceiling ${counter}` });
    await controls.assignSpaces({ id: group.id }, [spaceId]);
    const on = { enabled: true, message: 'stored' };
    await controls.set({ kind: 'instance' }, 'features.approvals', on);
    await controls.set({ kind: 'group', id: group.id }, 'features.approvals', on);
    await controls.set({ kind: 'space', id: spaceId }, 'features.approvals', on);

    expect(await store.feature(spaceId, 'approvals')).toEqual({
      enabled: false,
      presentation: 'locked',
      message: 'Needs a license',
      link: 'https://buy.test',
    });
    await expect(store.assertFeature(spaceId, 'approvals')).rejects.toMatchObject({
      key: 'control.feature',
    });
  });

  it('drop cached values on a version bump, a plugin flag no scope sets included', async () => {
    const { manablox, store } = processWith(new MemoryCache(5));
    const ceiling = provider();
    manablox.ceilings.add(ceiling);
    const spaceId = await freshSpace();
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'features.tags', { enabled: true });

    expect((await store.feature(spaceId, 'plugins.capped')).enabled).toBe(true);
    expect(await manablox.plugins.isOn('capped', spaceId)).toBe(true);
    expect((await store.feature(null, 'plugins.capped')).enabled).toBe(true);

    ceiling.set({ 'plugins.capped': locked });
    expect((await store.feature(spaceId, 'plugins.capped')).message).toBe('Needs a license');
    expect(await manablox.plugins.isOn('capped', spaceId)).toBe(false);
    expect((await store.feature(null, 'plugins.capped')).enabled).toBe(false);
    expect((await store.resolved(null)).features['plugins.capped']?.enabled).toBe(false);

    ceiling.set({});
    expect(await manablox.plugins.isOn('capped', spaceId)).toBe(true);
    expect((await store.resolved(null)).features['plugins.capped']).toBeUndefined();
  });

  it('never reach the shared cache: a process without them reads the stored values', async () => {
    const shared = new MemoryCache(5);
    const capped = processWith(shared);
    const plain = processWith(shared);
    const ceiling = provider();
    capped.manablox.ceilings.add(ceiling);
    ceiling.set({ approvals: locked });
    const spaceId = await freshSpace();
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'features.tags', { enabled: true });

    expect((await capped.store.feature(spaceId, 'approvals')).enabled).toBe(false);
    ctx.resetQueryCount();
    // Read from the shared cache, which holds what the database stores.
    expect((await plain.store.feature(spaceId, 'approvals')).enabled).toBe(true);
    expect(ctx.queries().some((sql) => /control_settings.*scope_kind/is.test(sql))).toBe(false);
  });

  it('put the ceiling banners before the stored ones', async () => {
    const { manablox, store } = processWith(new MemoryCache(5));
    const banner = {
      id: 'ceiling',
      level: 'warning',
      text: 'Payment failed',
      dismissible: true,
      audience: 'superadmin',
    } as const;
    manablox.ceilings.add({ features: () => new Map(), version: () => 1, banners: () => [banner] });
    await ctx.controls.set({ kind: 'instance' }, 'admin.banners', [
      { ...banner, id: 'stored', audience: 'all' },
    ]);
    const banners = (await store.resolved(null)).messages.banners;
    expect(banners.map((entry) => entry.id)).toEqual(['ceiling', 'stored']);
  });
});
