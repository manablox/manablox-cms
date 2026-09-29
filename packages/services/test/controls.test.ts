import { MemoryCache } from '@manablox/cache';
import { DefaultControls, type ManabloxConfig, ManabloxError } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { ControlSettingRepository } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ControlService,
  ControlStore,
  installControls,
  type LimitCountTarget,
} from '../src/controls/index.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let counter = 0;

beforeAll(async () => {
  ctx = await createServiceContext('controls', {
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
  for (const group of await ctx.repos.spaceGroups.list())
    await ctx.repos.spaceGroups.delete(group.id);
  ctx.controlStore.forget(null);
});

const freshSpace = async () => {
  const name = `ctl-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://c.test' })).id;
};

async function failure(run: Promise<unknown>): Promise<ManabloxError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!ManabloxError.is(error)) throw new Error(`expected a ManabloxError, got ${String(error)}`);
  return error;
}

describe('writes', () => {
  it('refuses an unknown key, a scope the key does not allow and an invalid value', async () => {
    const spaceId = await freshSpace();
    const space = { kind: 'space', id: spaceId } as const;

    const unknown = await failure(ctx.controls.set(space, 'features.nope', { enabled: false }));
    expect(unknown.kind).toBe('validation');
    expect(unknown.details).toEqual([
      { key: 'control.key.unknown', path: ['features.nope'], params: { key: 'features.nope' } },
    ]);

    const scope = await failure(ctx.controls.set(space, 'features.apiKeys', { enabled: false }));
    expect(scope.details[0]).toMatchObject({ key: 'control.scope.notAllowed' });

    const value = await failure(ctx.controls.set(space, 'features.databags', { enabled: 'no' }));
    expect(value.details[0]).toMatchObject({
      key: 'control.value.invalid',
      path: ['features.databags', 'enabled'],
    });

    const suspended = await failure(ctx.controls.set(space, 'state', { status: 'suspended' }));
    expect(suspended.details[0]).toMatchObject({ key: 'control.value.invalid' });

    // One bad key stops the whole patch.
    await failure(
      ctx.controls.patch(space, { 'features.databags': { enabled: false }, 'limits.nope': {} }),
    );
    expect(await ctx.controls.settings(space)).toEqual({});
  });

  it('refuses a scope that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await failure(ctx.controls.settings({ kind: 'space', id: missing }))).key).toBe(
      'space.notFound',
    );
    expect(
      (
        await failure(
          ctx.controls.set({ kind: 'group', id: missing }, 'features.databags', { enabled: false }),
        )
      ).key,
    ).toBe('spaceGroup.notFound');
  });

  it('stores parsed values and audits them as the control API', async () => {
    const stored = await ctx.controls.set({ kind: 'instance' }, 'limits.seats', { max: 5 });
    expect(stored).toEqual({ max: 5, mode: 'hard' });
    expect(await ctx.controls.settings({ kind: 'instance' })).toEqual({
      'limits.seats': { max: 5, mode: 'hard' },
    });

    const page = await ctx.audit.listInstance({ actorKind: 'control', actions: ['control.set'] });
    expect(page.items[0]).toMatchObject({
      spaceId: null,
      actorKind: 'control',
      targetKind: 'control',
      targetId: 'instance',
      changes: [{ path: 'limits.seats', to: { max: 5, mode: 'hard' } }],
    });
  });

  it('patches some keys and deletes one', async () => {
    const instance = { kind: 'instance' } as const;
    await ctx.controls.patch(instance, {
      'features.databags': { enabled: false },
      'limits.spaces': { max: 3 },
    });
    await ctx.controls.patch(instance, { 'limits.spaces': { max: 4, mode: 'soft' } });
    expect(await ctx.controls.settings(instance)).toEqual({
      'features.databags': { enabled: false },
      'limits.spaces': { max: 4, mode: 'soft' },
    });
    expect(await ctx.controls.delete(instance, 'features.databags')).toBe(true);
    expect(await ctx.controls.delete(instance, 'features.databags')).toBe(false);
    expect(await ctx.controls.settings(instance)).toEqual({
      'limits.spaces': { max: 4, mode: 'soft' },
    });
  });

  it('replaces a scope as a whole, or not at all', async () => {
    const spaceId = await freshSpace();
    const space = { kind: 'space', id: spaceId } as const;
    await ctx.controls.patch(space, {
      'features.databags': { enabled: false },
      'features.menus': { enabled: false },
    });

    await failure(
      ctx.controls.replaceScope(space, { 'features.tags': { enabled: false }, bad: true }),
    );
    expect(Object.keys(await ctx.controls.settings(space))).toEqual([
      'features.databags',
      'features.menus',
    ]);

    // A failure after the old keys are removed rolls them back.
    const prototype = ControlSettingRepository.prototype as unknown as {
      write: () => Promise<unknown>;
    };
    const write = vi.spyOn(prototype, 'write').mockRejectedValueOnce(new Error('boom'));
    await expect(
      ctx.controls.replaceScope(space, { 'features.tags': { enabled: false } }),
    ).rejects.toThrow('boom');
    write.mockRestore();
    expect(Object.keys(await ctx.controls.settings(space))).toEqual([
      'features.databags',
      'features.menus',
    ]);

    expect(await ctx.controls.replaceScope(space, { 'features.tags': { enabled: false } })).toEqual(
      { 'features.tags': { enabled: false } },
    );
    expect(await ctx.controls.replaceScope(space, {})).toEqual({});
  });
});

describe('suspension', () => {
  it("purges every space's deliveries when suspended and when lifted", async () => {
    const spaceId = await freshSpace();
    const instance = { kind: 'instance' } as const;
    const purges: string[][] = [];
    const off = ctx.manablox.hooks.on('cache:purge', (payload) => {
      purges.push(payload.tags);
      return payload;
    });
    try {
      await ctx.controls.set(instance, 'state', { status: 'readOnly' });
      await ctx.controls.set(instance, 'features.databags', { enabled: false });
      expect(purges).toEqual([]);

      await ctx.controls.set(instance, 'state', { status: 'suspended' });
      expect(purges).toHaveLength(1);
      expect(purges[0]).toContain(`space:${spaceId}`);
      await ctx.controls.set(instance, 'state', { status: 'suspended', message: 'Paused' });
      expect(purges).toHaveLength(1);

      await ctx.controls.set(instance, 'state', { status: 'active' });
      expect(purges).toHaveLength(2);
      expect(purges[1]).toContain(`space:${spaceId}`);

      await ctx.controls.set(instance, 'state', { status: 'suspended' });
      await ctx.controls.delete(instance, 'state');
      expect(purges).toHaveLength(4);
    } finally {
      off();
    }
  });
});

describe('groups', () => {
  it('creates, renames, finds by external id and refuses a taken external id', async () => {
    const group = await ctx.controls.createGroup({ name: 'Pro', externalId: 'plan-pro' });
    expect((await ctx.controls.group({ externalId: 'plan-pro' })).id).toBe(group.id);
    const renamed = await ctx.controls.updateGroup({ id: group.id }, { name: 'Pro+' });
    expect(renamed.name).toBe('Pro+');

    const taken = await failure(ctx.controls.createGroup({ name: 'X', externalId: 'plan-pro' }));
    expect(taken.details[0]).toMatchObject({ key: 'spaceGroup.externalId.taken' });
    expect((await failure(ctx.controls.group({ externalId: 'none' }))).key).toBe(
      'spaceGroup.notFound',
    );
  });

  it('assigns spaces, moving them out of other groups, and refuses unknown spaces', async () => {
    const [a, b] = [await freshSpace(), await freshSpace()];
    const one = await ctx.controls.createGroup({ name: 'One' });
    const two = await ctx.controls.createGroup({ name: 'Two' });
    expect(await ctx.controls.assignSpaces({ id: one.id }, [a, b])).toHaveLength(2);
    expect(await ctx.controls.assignSpaces({ id: two.id }, [b])).toEqual([b]);
    expect((await ctx.controls.groupSpaces({ id: one.id })).map((space) => space.id)).toEqual([a]);
    expect(await ctx.controls.assignSpaces({ id: two.id }, [], { replace: true })).toEqual([b]);

    const missing = '00000000-0000-4000-8000-000000000001';
    expect((await failure(ctx.controls.assignSpaces({ id: one.id }, [missing]))).key).toBe(
      'space.notFound',
    );
  });

  it('deletes a group with its values; its spaces stay without a group', async () => {
    const spaceId = await freshSpace();
    const group = await ctx.controls.createGroup({ name: 'Gone' });
    await ctx.controls.assignSpaces({ id: group.id }, [spaceId]);
    await ctx.controls.set({ kind: 'group', id: group.id }, 'features.databags', {
      enabled: false,
    });
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(false);

    await ctx.controls.deleteGroup({ id: group.id });
    expect(await ctx.repos.controlSettings.listByScope({ kind: 'group', id: group.id })).toEqual(
      [],
    );
    expect((await ctx.repos.spaces.findById(spaceId))?.groupId).toBeNull();
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(true);
  });
});

describe('resolution', () => {
  it('resolves instance, group and space rows from the database', async () => {
    const spaceId = await freshSpace();
    const group = await ctx.controls.createGroup({ name: 'Resolved' });
    await ctx.controls.assignSpaces({ id: group.id }, [spaceId]);
    await ctx.controls.set({ kind: 'instance' }, 'features.databags', {
      enabled: true,
      presentation: 'hidden',
    });
    await ctx.controls.set({ kind: 'group', id: group.id }, 'features.menus', {
      enabled: false,
      message: 'Upgrade',
    });
    await ctx.controls.set({ kind: 'instance' }, 'limits.seats', { max: 50 });
    await ctx.controls.set({ kind: 'group', id: group.id }, 'limits.seats', {
      max: 10,
      mode: 'soft',
    });
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'limits.seats', { max: 3 });

    const resolved = await ctx.controlStore.resolved(spaceId);
    expect(resolved.scopes).toEqual([
      { kind: 'instance' },
      { kind: 'group', id: group.id },
      { kind: 'space', id: spaceId },
    ]);
    expect(resolved.features.databags).toEqual({ enabled: true, presentation: 'hidden' });
    expect(resolved.features.menus).toEqual({
      enabled: false,
      presentation: 'locked',
      message: 'Upgrade',
    });
    expect(resolved.limits.seats.map((limit) => [limit.scope.kind, limit.max, limit.mode])).toEqual(
      [
        ['instance', 50, 'hard'],
        ['group', 10, 'soft'],
        ['space', 3, 'hard'],
      ],
    );

    // Another space sees the instance values only.
    const other = await ctx.controlStore.resolved(await freshSpace());
    expect(other.features.menus.enabled).toBe(true);
    expect(other.limits.seats).toHaveLength(1);
    expect((await ctx.controlStore.resolved(null)).scopes).toEqual([{ kind: 'instance' }]);
  });

  it('with no rows, resolves to exactly the catalogue defaults', async () => {
    const spaceId = await freshSpace();
    const defaults = new DefaultControls();
    expect(await ctx.controlStore.resolved(spaceId)).toEqual(await defaults.resolved(spaceId));
    expect(await ctx.controlStore.resolved(null)).toEqual(await defaults.resolved(null));
    expect(await ctx.controlStore.feature(spaceId, 'plugins.seo')).toEqual(
      await defaults.feature(spaceId, 'plugins.seo'),
    );
    await expect(ctx.controlStore.assertFeature(spaceId, 'databags')).resolves.toBeUndefined();
    await expect(ctx.controlStore.assertLimit(spaceId, 'seats')).resolves.toEqual([]);
    expect(ctx.manablox.controls).toBe(ctx.controlStore);
  });

  it('with no rows, reports every feature on, no limits and nothing restricted', async () => {
    const spaceId = await freshSpace();
    for (const scope of [spaceId, null]) {
      const resolved = await ctx.controlStore.resolved(scope);
      for (const [key, feature] of Object.entries(resolved.features)) {
        expect(feature?.enabled, key).toBe(true);
      }
      for (const [key, limits] of Object.entries(resolved.limits)) expect(limits, key).toEqual([]);
      for (const [metric, limits] of Object.entries(resolved.usage.limits)) {
        expect(limits, metric).toEqual([]);
      }
      expect(resolved.usage.status).toEqual({});
      expect(resolved.state.status).toBe('active');
      expect(resolved.uploads).toEqual({ maxFileSize: null, allowedMimeTypes: null });
      expect(resolved.messages).toEqual({ banners: [], links: {} });
      expect(resolved.rateLimitScopes).toEqual({});
      const { snapshotsDays, controlEventsDays, auditExport, ...kept } = resolved.retention;
      expect(Object.values(kept).every((days) => days === null)).toBe(true);
      expect({ snapshotsDays, controlEventsDays, auditExport }).toEqual({
        snapshotsDays: 7,
        controlEventsDays: 30,
        auditExport: false,
      });
      expect(resolved.settings).toMatchObject({
        domainsRequireVerification: false,
        authRequireEmailVerification: false,
        apiKeysDisable: false,
      });
    }
  });

  it('takes one query for the whole instance while nothing is stored', async () => {
    const [a, b] = [await freshSpace(), await freshSpace()];
    ctx.resetQueryCount();
    await ctx.controlStore.resolved(a);
    await ctx.controlStore.resolved(b);
    await ctx.controlStore.resolved(null);
    await ctx.controlStore.feature(a, 'databags');
    expect(ctx.queryCount()).toBe(1);

    // The first write ends the fast path.
    await ctx.controls.set({ kind: 'space', id: b }, 'features.databags', { enabled: false });
    expect((await ctx.controlStore.feature(a, 'databags')).enabled).toBe(true);
    expect((await ctx.controlStore.feature(b, 'databags')).enabled).toBe(false);
  });

  it('serves repeated reads from the cache and sees every write at once', async () => {
    const spaceId = await freshSpace();
    await ctx.controls.set({ kind: 'instance' }, 'features.tags', { enabled: true });
    await ctx.controlStore.resolved(spaceId);
    ctx.resetQueryCount();
    await ctx.controlStore.resolved(spaceId);
    await ctx.controlStore.feature(spaceId, 'databags');
    expect(ctx.queryCount()).toBe(0);

    await ctx.controls.set({ kind: 'space', id: spaceId }, 'features.databags', { enabled: false });
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(false);
    await ctx.controls.set({ kind: 'instance' }, 'features.menus', { enabled: false });
    expect((await ctx.controlStore.feature(spaceId, 'menus')).enabled).toBe(false);
    await ctx.controls.delete({ kind: 'space', id: spaceId }, 'features.databags');
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(true);
  });

  it('follows group writes and group reassignments', async () => {
    const spaceId = await freshSpace();
    const locked = await ctx.controls.createGroup({ name: 'Locked' });
    const open = await ctx.controls.createGroup({ name: 'Open' });
    await ctx.controls.assignSpaces({ id: locked.id }, [spaceId]);
    await ctx.controls.set({ kind: 'group', id: locked.id }, 'features.databags', {
      enabled: false,
    });
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(false);

    await ctx.controls.assignSpaces({ id: open.id }, [spaceId]);
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(true);
    expect((await ctx.controlStore.resolved(spaceId)).scopes[1]).toEqual({
      kind: 'group',
      id: open.id,
    });

    await ctx.controls.set({ kind: 'group', id: open.id }, 'features.databags', { enabled: false });
    expect((await ctx.controlStore.feature(spaceId, 'databags')).enabled).toBe(false);
  });

  it('hands out values nobody can change', async () => {
    const resolved = await ctx.controlStore.resolved(await freshSpace());
    expect(() => {
      (resolved.features.databags as { enabled: boolean }).enabled = false;
    }).toThrow();
  });
});

describe('enforcement', () => {
  it('refuses a switched-off feature with its message and link', async () => {
    const spaceId = await freshSpace();
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'features.menus', {
      enabled: false,
      message: 'Menus are on Pro',
      link: 'https://example.com/upgrade',
    });
    const error = await failure(ctx.controlStore.assertFeature(spaceId, 'menus'));
    expect(error).toMatchObject({ key: 'control.feature', kind: 'forbidden', status: 403 });
    expect(error.details[0]?.params).toEqual({
      feature: 'menus',
      message: 'Menus are on Pro',
      link: 'https://example.com/upgrade',
    });
    await expect(ctx.controlStore.assertFeature(spaceId, 'tags')).resolves.toBeUndefined();
  });

  it('checks every scope with the counter, hard refusing and soft passing', async () => {
    const [a, b, c] = [await freshSpace(), await freshSpace(), await freshSpace()];
    const group = await ctx.controls.createGroup({ name: 'Counted' });
    await ctx.controls.assignSpaces({ id: group.id }, [a, b]);
    // One item per space, ten in the whole instance.
    const seen: LimitCountTarget[] = [];
    const off = ctx.controlStore.registerLimitCounter('customDomains', async (target) => {
      seen.push(target);
      return target.spaceIds === 'all' ? 10 : target.spaceIds.length;
    });

    try {
      await ctx.controls.set({ kind: 'space', id: a }, 'limits.customDomains', { max: 1 });
      const space = await failure(ctx.controlStore.assertLimit(a, 'customDomains'));
      expect(space).toMatchObject({ key: 'control.limit', kind: 'conflict', status: 409 });
      expect(space.details[0]?.params).toEqual({
        limit: 'customDomains',
        scope: `space:${a}`,
        used: 1,
        max: 1,
      });
      expect(seen).toEqual([{ scope: { kind: 'space', id: a }, spaceIds: [a], spaceId: a }]);

      await ctx.controls.set({ kind: 'space', id: a }, 'limits.customDomains', {
        max: 1,
        mode: 'soft',
      });
      const soft = await ctx.controlStore.assertLimit(a, 'customDomains');
      expect(soft.map((breach) => [breach.limit.scope, breach.used])).toEqual([
        [{ kind: 'space', id: a }, 1],
      ]);

      await ctx.controls.set({ kind: 'space', id: a }, 'limits.customDomains', {
        max: 1,
        mode: 'off',
      });
      seen.length = 0;
      expect(await ctx.controlStore.assertLimit(a, 'customDomains')).toEqual([]);
      expect(seen).toEqual([]);

      await ctx.controls.set({ kind: 'group', id: group.id }, 'limits.customDomains', { max: 2 });
      seen.length = 0;
      const grouped = await failure(ctx.controlStore.assertLimit(b, 'customDomains'));
      expect(grouped.details[0]?.params).toMatchObject({ scope: `group:${group.id}`, used: 2 });
      expect(seen[0]?.scope).toEqual({ kind: 'group', id: group.id });
      expect([...(seen[0]?.spaceIds as string[])].sort()).toEqual([a, b].sort());
      // Outside the group only the instance applies, which sets nothing.
      expect(await ctx.controlStore.assertLimit(c, 'customDomains')).toEqual([]);

      await ctx.controls.set({ kind: 'instance' }, 'limits.customDomains', { max: 11 });
      expect(await ctx.controlStore.assertLimit(c, 'customDomains')).toEqual([]);
      const instance = await failure(
        ctx.controlStore.assertLimit(c, 'customDomains', { increment: 2 }),
      );
      expect(instance.details[0]?.params).toMatchObject({ scope: 'instance', used: 10, max: 11 });
    } finally {
      off();
    }
    // The built-in counter is back; no API hosts exist.
    const restored = await failure(
      ctx.controlStore.assertLimit(a, 'customDomains', { increment: 100 }),
    );
    expect(restored.details[0]?.params).toMatchObject({ scope: 'instance', used: 0 });
  });
});

describe('cleanup', () => {
  it('removes the values and counters of a deleted space', async () => {
    const spaceId = await freshSpace();
    const scope = { kind: 'space', id: spaceId } as const;
    await ctx.controls.set(scope, 'features.databags', { enabled: false });
    await ctx.repos.usageCounters.increment({ scope, metric: 'apiRequests', period: 'total' }, 3);

    await ctx.spaces.delete(spaceId);
    expect(await ctx.repos.controlSettings.listByScope(scope)).toEqual([]);
    expect(await ctx.repos.usageCounters.listForScope(scope, 'total')).toEqual([]);
  });
});

describe('across processes', () => {
  it('drops the entries of other stores through the invalidation bus and the shared cache', async () => {
    const spaceId = await freshSpace();
    const shared = new MemoryCache(5);
    const writer = new ControlStore(ctx.manablox, ctx.repos, { shared });
    const reader = new ControlStore(ctx.manablox, ctx.repos, { shared });
    writer.connect({ publish: (key) => reader.forget(key.split(' ')) });
    const controls = new ControlService(ctx.manablox, ctx.repos, writer);

    await controls.set({ kind: 'instance' }, 'features.tags', { enabled: true });
    await writer.resolved(spaceId);
    ctx.resetQueryCount();
    // The reader finds the writer's value in the shared cache.
    expect((await reader.feature(spaceId, 'databags')).enabled).toBe(true);
    expect(ctx.queries().some((sql) => /control_settings.*scope_kind/is.test(sql))).toBe(false);

    await controls.set({ kind: 'space', id: spaceId }, 'features.databags', { enabled: false });
    expect((await reader.feature(spaceId, 'databags')).enabled).toBe(false);

    const group = await controls.createGroup({ name: 'Bus' });
    await controls.set({ kind: 'group', id: group.id }, 'features.menus', { enabled: false });
    expect((await reader.feature(spaceId, 'menus')).enabled).toBe(true);
    await controls.assignSpaces({ id: group.id }, [spaceId]);
    expect((await reader.feature(spaceId, 'menus')).enabled).toBe(false);
  });

  const redisUrl = process.env.TEST_REDIS_URL ?? '';
  const instances: Manablox[] = [];
  afterEach(async () => {
    await Promise.all(instances.splice(0).map((manablox) => manablox.stop()));
  });

  // Control values are configuration, not content: the cache flag leaves them cached.
  it('keeps resolved values with the cache on and with it off', async () => {
    for (const enabled of [true, false]) {
      const manablox = new Manablox({
        database: { url: 'postgres://unused' },
        auth: { secret: 'test' },
        fieldTypes: [],
        contentTypes: [],
        cache: { enabled },
        logLevel: 'silent',
      } as unknown as ManabloxConfig);
      instances.push(manablox);
      const store = installControls(manablox, ctx.repos);
      const controls = new ControlService(manablox, ctx.repos, store);
      const spaceId = await freshSpace();
      await controls.set({ kind: 'instance' }, 'features.tags', { enabled: true });
      expect((await store.feature(spaceId, 'databags')).enabled).toBe(true);
      // Written behind the store's back, without the purge a control write sends.
      await ctx.repos.controlSettings.upsert({ kind: 'space', id: spaceId }, 'features.databags', {
        enabled: false,
      });
      ctx.resetQueryCount();
      expect((await store.feature(spaceId, 'databags')).enabled).toBe(true);
      expect(ctx.queries().some((sql) => /control_settings/i.test(sql))).toBe(false);
      // A control write still drops them.
      await controls.set({ kind: 'space', id: spaceId }, 'features.menus', { enabled: false });
      expect((await store.feature(spaceId, 'databags')).enabled).toBe(false);
      expect((await store.feature(spaceId, 'menus')).enabled).toBe(false);
      for (const row of await ctx.repos.controlSettings.listAll()) {
        await ctx.repos.controlSettings.delete({ kind: row.scopeKind, id: row.scopeId }, row.key);
      }
    }
  });

  it.skipIf(!redisUrl).each([true, false])(
    'drops the entries of other processes over Redis (cache enabled: %s)',
    async (enabled) => {
      const process = () => {
        const manablox = new Manablox({
          database: { url: 'postgres://unused' },
          auth: { secret: 'test' },
          fieldTypes: [],
          contentTypes: [],
          cache: { redisUrl, enabled },
          logLevel: 'silent',
        } as unknown as ManabloxConfig);
        instances.push(manablox);
        return { manablox, store: installControls(manablox, ctx.repos) };
      };
      const writer = process();
      const reader = process();
      // Subscribing is asynchronous; an announcement before it would be missed.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const spaceId = await freshSpace();
      const controls = new ControlService(writer.manablox, ctx.repos, writer.store);

      await controls.set({ kind: 'instance' }, 'features.tags', { enabled: true });
      await writer.store.resolved(spaceId);
      ctx.resetQueryCount();
      // The reader finds the writer's value in the shared Redis cache, whatever the flag.
      expect((await reader.store.feature(spaceId, 'databags')).enabled).toBe(true);
      expect(ctx.queries().some((sql) => /control_settings.*scope_kind/is.test(sql))).toBe(false);
      expect(reader.manablox.controls).toBe(reader.store);

      await controls.set({ kind: 'space', id: spaceId }, 'features.databags', { enabled: false });
      await vi.waitFor(async () =>
        expect((await reader.store.feature(spaceId, 'databags')).enabled).toBe(false),
      );
    },
  );
});
