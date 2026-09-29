import type { ManabloxPlugin, PluginDataProvider } from '@manablox/core';
import type { Repositories, SpaceEnvironmentRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import {
  dataProviders,
  EnvironmentLifecycleService,
  registerLimitCounters,
  SnapshotService,
  type SnapshotStorage,
  SpaceTransferService,
} from '@manablox/services';
import {
  createServiceContext,
  type ServiceContext,
  withControls,
} from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { helloData } from '../fixtures/plugins/hello/data.js';
import { helloRepos } from '../fixtures/plugins/hello/db.js';
import { helloPlugin } from '../fixtures/plugins/hello/plugin.js';
import type { HelloLiveChange } from '../fixtures/plugins/hello/services.js';

/** Snapshot storage in a map. */
function memoryStorage(): Required<SnapshotStorage> {
  const objects = new Map<string, Buffer>();
  const read = (key: string) => {
    const body = objects.get(key);
    if (!body) throw Object.assign(new Error(`missing ${key}`), { code: 'ENOENT' });
    return body;
  };
  return {
    async put(key, body) {
      if (Buffer.isBuffer(body)) {
        objects.set(key, body);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
      objects.set(key, Buffer.concat(chunks));
    },
    get: async (key) => read(key),
    stream: async (key) => {
      const { Readable } = await import('node:stream');
      return Readable.from([read(key)]);
    },
    delete: async (key) => {
      objects.delete(key);
    },
    list: async (prefix) =>
      [...objects]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => ({ key, size: body.byteLength, lastModified: new Date() })),
  };
}

let ctx: ServiceContext;
let environments: EnvironmentLifecycleService;
let snapshots: SnapshotService;
let restore: () => Promise<void>;
let seq = 0;
let ownerId: string;
/** What the provider's `onLiveChange` records, in the services a server would build. */
const live: HelloLiveChange[] = [];

const greetings = (repos: Repositories = ctx.repos) => helloRepos(repos).greetings;

const messages = async (spaceId: string, environmentId?: string) =>
  (await greetings().list(environmentId ? { spaceId, environmentId } : spaceId))
    .map((row) => row.message)
    .sort();

async function freshSpace(): Promise<{ spaceId: string; production: SpaceEnvironmentRow }> {
  const name = `hello-data-${++seq}`;
  const space = await ctx.spaces.create(
    { name, machineName: name, url: 'http://hello.test' },
    null,
  );
  const production = await ctx.repos.environments.findByMachineName(space.id, 'production');
  return { spaceId: space.id, production: production as SpaceEnvironmentRow };
}

beforeAll(async () => {
  ctx = await createServiceContext('hello_data', {
    fieldTypes: builtinFieldTypes,
    contentTypes: [],
    config: { plugins: [helloPlugin()] },
  });
  ctx.manablox.providePlugin('hello', { services: { live } });
  restore = await withControls(ctx, {
    features: { environments: true, snapshots: true, customDomains: true },
  });
  ownerId = (
    await ctx.repos.users.create({
      name: 'Importer',
      email: 'hello-importer@example.com',
      role: 'editor',
      passwordHash: 'x',
    })
  ).id;
  const storage = memoryStorage();
  snapshots = new SnapshotService(
    ctx.manablox,
    ctx.repos,
    ctx.spaces,
    new SpaceTransferService(ctx.manablox, ctx.repos),
    storage,
    { controlStore: ctx.controlStore },
  );
  environments = new EnvironmentLifecycleService(ctx.manablox, ctx.repos, {
    contentTypes: ctx.contentTypes,
  });
});
afterAll(async () => {
  await restore?.();
  await ctx?.close();
});

describe('the hello data provider', () => {
  it('is registered after the built-in providers', () => {
    expect(dataProviders(ctx.manablox).map((provider) => provider.kind)).toContain(
      'hello.greetings',
    );
  });

  it('copies greetings into a full environment only', async () => {
    const { spaceId } = await freshSpace();
    const row = await greetings().create({ spaceId }, 'Hello');
    const config = await environments.create(spaceId, {
      machineName: 'plain',
      name: 'Plain',
      mode: 'config',
    });
    expect(await messages(spaceId, config.environment.id)).toEqual([]);
    expect(config.copied['hello.greetings']).toBeUndefined();

    const full = await environments.create(spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    expect(full.copied['hello.greetings']).toBe(1);
    const [copy] = await greetings().list({ spaceId, environmentId: full.environment.id });
    expect(copy).toMatchObject({ message: 'Hello', environmentId: full.environment.id });
    expect(copy?.id).not.toBe(row.id);
  });

  it('promotes greetings back onto their source rows', async () => {
    const { spaceId, production } = await freshSpace();
    const kept = await greetings().create({ spaceId }, 'Hello');
    const dropped = await greetings().create({ spaceId }, 'Bye');
    const { environment } = await environments.create(spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    const staged = await greetings().list({ spaceId, environmentId: environment.id });
    const hello = staged.find((row) => row.message === 'Hello');
    const bye = staged.find((row) => row.message === 'Bye');
    await greetings().update(hello?.id as string, 'Hello there');
    await greetings().remove(bye?.id as string);
    await greetings().create({ spaceId, environmentId: environment.id }, 'New');

    const diff = await environments.diff(spaceId, 'staging', 'full');
    expect(diff.changes.map((line) => line.kind)).toEqual([
      'contents',
      'menus',
      'redirects',
      'hello.greetings',
    ]);
    expect(diff.changes.find((line) => line.kind === 'hello.greetings')).toMatchObject({
      added: 1,
      changed: 1,
      removed: 1,
    });

    const result = await environments.promote(spaceId, 'staging', 'full', { confirm: true });
    expect(result.status).toBe('applied');
    expect(result.groups.map((group) => group.group)).toContain('hello.greetings');
    const live = await greetings().list({ spaceId, environmentId: production.id });
    expect(live.map((row) => row.message).sort()).toEqual(['Hello there', 'New']);
    // The edited row keeps its production id; the removed one is gone.
    expect(live.find((row) => row.message === 'Hello there')?.id).toBe(kept.id);
    expect(await greetings().findById(dropped.id)).toBeNull();
  });

  // Groups after a failed one are skipped; the services tests cover that with two providers.
  it('rolls back its promote group when it fails', async () => {
    const { spaceId, production } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    const { environment } = await environments.create(spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    await greetings().create({ spaceId, environmentId: environment.id }, 'Extra');
    const handler = helloData.environments as NonNullable<PluginDataProvider['environments']>;
    const spy = vi.spyOn(handler, 'promote').mockImplementation(async ({ repos, upsert }) => {
      await helloRepos(repos).greetings.insert(
        upsert.filter((row) => (row as { message?: string }).message === 'Extra') as never,
      );
      throw new Error('disk full');
    });
    try {
      const result = await environments.promote(spaceId, 'staging', 'full', { confirm: true });
      expect(result.status).toBe('partial');
      expect(result.groups.at(-1)).toEqual({
        group: 'hello.greetings',
        status: 'failed',
        error: 'environment.promote.failed',
      });
    } finally {
      spy.mockRestore();
    }
    expect(await messages(spaceId, production.id)).toEqual(['Hello']);
  });

  it('rolls back an environment copy when it fails', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    const handler = helloData.environments as NonNullable<PluginDataProvider['environments']>;
    const spy = vi.spyOn(handler, 'copy').mockRejectedValue(new Error('disk full'));
    try {
      await expect(
        environments.create(spaceId, { machineName: 'broken', name: 'Broken', mode: 'full' }),
      ).rejects.toThrow('disk full');
    } finally {
      spy.mockRestore();
    }
    expect(await ctx.repos.environments.findByMachineName(spaceId, 'broken')).toBeNull();
  });

  it('hears of every change to the environments, once it committed', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    await environments.create(spaceId, { machineName: 'staging', name: 'Staging', mode: 'full' });
    await environments.promote(spaceId, 'staging', 'full', { confirm: true });
    await environments.delete(spaceId, 'staging');
    expect(live.filter((change) => change.spaceId === spaceId)).toEqual([
      { spaceId, reason: 'create' },
      { spaceId, reason: 'promote' },
      { spaceId, reason: 'delete' },
    ]);
  });

  it('writes its greetings as config, with their own define function', async () => {
    const { spaceId } = await freshSpace();
    const hello = await greetings().create({ spaceId }, 'Hello');
    await greetings().create({ spaceId }, 'Hi');
    const inventory = await ctx.spaces.configInventory(spaceId);
    expect(inventory.plugins).toEqual([
      expect.objectContaining({
        kind: 'hello.greeting',
        label: 'Greetings',
        icon: 'star',
        entries: [
          expect.objectContaining({ label: 'Hello' }),
          expect.objectContaining({ label: 'Hi' }),
        ],
      }),
    ]);

    const all = await ctx.spaces.configSource(spaceId);
    expect(all.counts['hello.greeting']).toBe(2);
    expect(all.code).toContain("import { defineGreeting } from 'hello-plugin/define';");
    expect(all.code).toContain("export const hello = defineGreeting({\n  slug: 'hello',");
    expect(all.code).toContain("    'hello.greeting': [hello, hi],");

    const one = await ctx.spaces.configSource(spaceId, {
      kinds: ['hello.greeting'],
      ids: { 'hello.greeting': [hello.id] },
    });
    expect(one.counts['hello.greeting']).toBe(1);
    expect(one.code).not.toContain('defineContentType');
    expect(one.code).not.toContain('hi = ');
  });

  it('drops greetings with their environment', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    const { environment } = await environments.create(spaceId, {
      machineName: 'staging',
      name: 'Staging',
      mode: 'full',
    });
    await environments.delete(spaceId, 'staging');
    expect(await messages(spaceId, environment.id)).toEqual([]);
    expect(await messages(spaceId)).toEqual(['Hello']);
  });

  it('travels in a space export and import', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    await greetings().create({ spaceId }, 'Hi');
    // Shouted greetings stay out of exports.
    await greetings().create({ spaceId }, 'HEY');
    expect((await ctx.spaces.inventory(spaceId)).plugins['hello.greetings']).toBe(2);

    const payload = await ctx.spaces.export(spaceId);
    expect(payload.sections).toContain('hello.greetings');
    expect(payload.plugins?.['hello.greetings']).toHaveLength(2);
    const copy = {
      ...payload,
      space: { ...payload.space, id: crypto.randomUUID(), machineName: `copy-${++seq}` },
    };
    const result = await ctx.spaces.import(copy, ownerId);
    expect(result.plugins['hello.greetings']).toBe(2);
    expect(await messages(copy.space.id)).toEqual(['Hello', 'Hi']);

    const without = { ...payload, space: { ...copy.space, id: crypto.randomUUID() } };
    without.space.machineName = `copy-${++seq}`;
    const skipped = await ctx.spaces.import(without, ownerId, { sections: ['menus'] });
    expect(skipped.plugins['hello.greetings']).toBe(0);
    expect(await messages(without.space.id)).toEqual([]);
  });

  it('lets its entries be picked one by one on export and import', async () => {
    const { spaceId } = await freshSpace();
    const hello = await greetings().create({ spaceId }, 'Hello');
    const hi = await greetings().create({ spaceId }, 'Hi');
    const inventory = await ctx.spaces.inventory(spaceId);
    expect(inventory.pluginEntries['hello.greetings']).toEqual([
      { id: hello.id, label: 'Hello' },
      { id: hi.id, label: 'Hi' },
    ]);

    const picked = await ctx.spaces.export(spaceId, { ids: { 'hello.greetings': [hi.id] } });
    expect(picked.plugins?.['hello.greetings']).toEqual([expect.objectContaining({ id: hi.id })]);

    const payload = await ctx.spaces.export(spaceId);
    const copy = {
      ...payload,
      space: { ...payload.space, id: crypto.randomUUID(), machineName: `copy-${++seq}` },
    };
    await ctx.spaces.import(copy, ownerId, { ids: { 'hello.greetings': [hello.id] } });
    expect(await messages(copy.space.id)).toEqual(['Hello']);
  });

  it('rolls back its import step when it fails', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    const payload = await ctx.spaces.export(spaceId);
    const copy = {
      ...payload,
      space: { ...payload.space, id: crypto.randomUUID(), machineName: `broken-${++seq}` },
    };
    const transfer = helloData.transfer as NonNullable<PluginDataProvider['transfer']>;
    const spy = vi.spyOn(transfer, 'import').mockImplementation(async ({ repos, spaceId: id }) => {
      await helloRepos(repos).greetings.create({ spaceId: id }, 'Half');
      throw new Error('disk full');
    });
    try {
      await expect(ctx.spaces.import(copy, ownerId)).rejects.toMatchObject({
        key: 'space.import.failed',
      });
    } finally {
      spy.mockRestore();
    }
    expect(await messages(copy.space.id)).toEqual([]);
    expect((await ctx.repos.spaces.findById(copy.space.id))?.importProgress).toMatchObject({
      step: 'hello.greetings',
    });
  });

  it('is captured by a snapshot and restored with it', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    await greetings().create({ spaceId }, 'HEY');
    const manifest = await snapshots.create(spaceId);
    await greetings().create({ spaceId }, 'Later');
    const { stream } = await snapshots.open(spaceId, manifest.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const file = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(file.plugins['hello.greetings']).toEqual([
      expect.objectContaining({ message: 'Hello' }),
    ]);
    expect(file.snapshots['hello.greetings']).toEqual([
      expect.objectContaining({ message: 'HEY' }),
    ]);

    const restored = await snapshots.restore(spaceId, manifest.id, { mode: 'new' });
    expect(restored.import.plugins['hello.greetings']).toBe(1);
    expect(await messages(restored.spaceId)).toEqual(['HEY', 'Hello']);
    expect(await messages(spaceId)).toEqual(['HEY', 'Hello', 'Later']);
  });

  it('counts its snapshot state against the limit of a restore', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    await greetings().create({ spaceId }, 'HEY');
    const manifest = await snapshots.create(spaceId);
    const used = await greetings().countForSpaces('all');
    const limit = (max: number) =>
      withControls(ctx, { values: { 'limits.plugins.hello.greetings': { max } } });
    const undo = await limit(used + 1);
    try {
      // Beside the space: the section and the state add two.
      await expect(snapshots.restore(spaceId, manifest.id, { mode: 'new' })).rejects.toMatchObject({
        key: 'control.limit',
      });
      await limit(used);
      // In its place: the replaced space already counts both.
      const replaced = await snapshots.restore(spaceId, manifest.id, { mode: 'replace' });
      expect(await messages(replaced.spaceId)).toEqual(['HEY', 'Hello']);
    } finally {
      await undo();
    }
  });

  it('rolls back its snapshot restore when it fails, keeping the replaced space', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'HEY');
    const manifest = await snapshots.create(spaceId);
    const snapshot = helloData.snapshot as NonNullable<PluginDataProvider['snapshot']>;
    const spy = vi.spyOn(snapshot, 'restore').mockImplementation(async ({ repos, spaceId: id }) => {
      await helloRepos(repos).greetings.create({ spaceId: id }, 'Half');
      throw new Error('disk full');
    });
    try {
      await expect(
        snapshots.restore(spaceId, manifest.id, { mode: 'replace' }),
      ).rejects.toMatchObject({ key: 'space.import.failed' });
    } finally {
      spy.mockRestore();
    }
    expect(await messages(spaceId)).toEqual(['HEY']);
    const source = await ctx.repos.spaces.findById(spaceId);
    const failed = (await ctx.repos.spaces.list()).find(
      (space) =>
        space.importStatus === 'failed' &&
        space.machineName.startsWith(`${source?.machineName}-restoring-`),
    );
    expect(failed?.importProgress).toMatchObject({ step: 'snapshot:hello.greetings' });
    expect(await messages(failed?.id as string)).toEqual([]);
  });

  it('counts its own limit', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    await greetings().create({ spaceId }, 'Hi');
    const limit = (max: number) =>
      withControls(ctx, {
        scope: { kind: 'space', id: spaceId },
        values: { 'limits.plugins.hello.greetings': { max } },
      });
    const assert = () => ctx.manablox.controls.assertLimit(spaceId, 'plugins.hello.greetings');
    await limit(2);
    await expect(assert()).rejects.toMatchObject({ key: 'control.limit' });
    await limit(3);
    await expect(assert()).resolves.toEqual([]);
  });

  it('refuses plugin limits without a counter and counters of other limits', () => {
    const refusal = (plugin: ManabloxPlugin) => {
      try {
        dataProviders({ config: { ...ctx.manablox.config, plugins: [plugin] } });
      } catch (error) {
        return (error as { key?: string }).key;
      }
      return null;
    };
    const limit = { 'limits.plugins.hello.greetings': { description: 'Greetings.' } };
    const count = async () => 0;
    expect(refusal({ name: 'hello', controls: limit })).toBe('plugin.key.invalid');
    expect(
      refusal({
        name: 'hello',
        data: [{ kind: 'hello.x', counters: { 'plugins.hello.greetings': count } }],
      }),
    ).toBe('plugin.key.invalid');
    expect(
      refusal({
        name: 'hello',
        controls: limit,
        data: [{ kind: 'hello.x', counters: { 'plugins.other.greetings': count } }],
      }),
    ).toBe('plugin.key.invalid');
    expect(
      refusal({
        name: 'hello',
        controls: limit,
        data: [{ kind: 'hello.x', counters: { 'plugins.hello.greetings': count, spaces: count } }],
      }),
    ).toBeNull();
  });

  it('adds its counters to core limits', async () => {
    const { spaceId } = await freshSpace();
    await greetings().create({ spaceId }, 'Hello');
    const counted: PluginDataProvider = {
      kind: 'hello.counted',
      counters: {
        customDomains: ({ repos }, spaceIds) =>
          helloRepos(repos).greetings.countForSpaces(spaceIds),
      },
    };
    const manablox = {
      ...ctx.manablox,
      config: { ...ctx.manablox.config, plugins: [{ name: 'hello', data: [counted] }] },
    } as typeof ctx.manablox;
    type Counter = Parameters<ServiceContext['controlStore']['registerLimitCounter']>[1];
    const counters = new Map<string, Counter>();
    // Caught rather than registered, so the shared store keeps its own counters.
    const spy = vi
      .spyOn(ctx.controlStore, 'registerLimitCounter')
      .mockImplementation((key, counter) => {
        counters.set(key, counter);
        return () => {};
      });
    try {
      registerLimitCounters(ctx.controlStore, ctx.repos, manablox);
    } finally {
      spy.mockRestore();
    }
    const count = counters.get('customDomains');
    await ctx.apiHosts.create(spaceId, `hello-${seq}.example.com`);
    const target = { scope: { kind: 'space' as const, id: spaceId }, spaceId, spaceIds: [spaceId] };
    expect(await count?.(target)).toBe(2);
  });
});
