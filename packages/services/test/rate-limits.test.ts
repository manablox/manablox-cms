import { definePlugin, memoryRateLimitStore } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let counter = 0;

/** A plugin that caps its jobs at once, as a concurrency rule. */
const queuePlugin = definePlugin({
  name: 'queue',
  controls: {
    'rateLimits.plugins.queue.jobs': { description: 'Jobs at once per scope.', concurrency: true },
  },
});

beforeAll(async () => {
  ctx = await createServiceContext('rate_limits', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    config: { plugins: [queuePlugin] },
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
  ctx.controlStore.rates = memoryRateLimitStore();
});

const freshSpace = async () => {
  const name = `rl-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://r.test' })).id;
};

const hit = (spaceId: string | null, key = 'k') =>
  ctx.controlStore.rate(spaceId, [{ rule: 'delivery.space', key }]);

describe('rate rules by scope', () => {
  it('uses the catalogue default while no scope sets the rule, else the config fallback', async () => {
    const spaceId = await freshSpace();
    // `delivery.ip` defaults to 300 per minute.
    const byDefault = await ctx.controlStore.rate(spaceId, [{ rule: 'delivery.ip', key: 'ip' }]);
    expect(byDefault).toMatchObject({
      rule: 'delivery.ip',
      allowed: true,
      limit: 300,
      remaining: 299,
    });
    expect(byDefault?.reset).toBeGreaterThan(0);
    expect(byDefault?.reset).toBeLessThanOrEqual(60);
    // Without a default nothing is counted.
    expect(await hit(spaceId)).toBeNull();

    const fallback = { max: 2, windowSeconds: 60 };
    const withFallback = await ctx.controlStore.rate(spaceId, [
      { rule: 'delivery.ip', key: 'ip2', fallback },
    ]);
    expect(withFallback).toMatchObject({ limit: 2 });
    // A set value wins over the fallback.
    await ctx.controls.set({ kind: 'instance' }, 'rateLimits.delivery.ip', {
      max: 5,
      windowSeconds: 60,
    });
    const set = await ctx.controlStore.rate(spaceId, [
      { rule: 'delivery.ip', key: 'ip3', fallback },
    ]);
    expect(set).toMatchObject({ limit: 5 });
  });

  it('takes the most specific scope: space over group over instance', async () => {
    const [grouped, alone] = [await freshSpace(), await freshSpace()];
    const group = await ctx.controls.createGroup({ name: `rl-group-${counter}` });
    await ctx.controls.assignSpaces({ id: group.id }, [grouped]);

    await ctx.controls.set({ kind: 'instance' }, 'rateLimits.delivery.space', {
      max: 3,
      windowSeconds: 60,
    });
    expect(await hit(alone, 'a')).toMatchObject({ limit: 3 });
    expect(await hit(grouped, 'b')).toMatchObject({ limit: 3 });

    await ctx.controls.set({ kind: 'group', id: group.id }, 'rateLimits.delivery.space', {
      max: 2,
      windowSeconds: 60,
    });
    expect(await hit(grouped, 'c')).toMatchObject({ limit: 2 });
    expect(await hit(alone, 'd')).toMatchObject({ limit: 3 });

    await ctx.controls.set({ kind: 'space', id: grouped }, 'rateLimits.delivery.space', {
      max: 1,
      windowSeconds: 60,
    });
    expect(await hit(grouped, 'e')).toMatchObject({ limit: 1, allowed: true });
    const refused = await hit(grouped, 'e');
    expect(refused).toMatchObject({ rule: 'delivery.space', allowed: false, remaining: 0 });
    expect(refused?.retryAfter).toBeGreaterThan(0);
    await expect(
      ctx.controlStore.assertRate(grouped, [{ rule: 'delivery.space', key: 'e' }]),
    ).rejects.toMatchObject({
      key: 'rateLimit.exceeded',
      kind: 'rate_limited',
      details: [{ params: { rule: 'delivery.space', retryAfter: expect.any(Number) } }],
    });

    // A `null` at the space lifts the group's limit there.
    await ctx.controls.set({ kind: 'space', id: grouped }, 'rateLimits.delivery.space', null);
    expect(await hit(grouped, 'f')).toBeNull();
  });

  it('starts a fresh count when the window changes', async () => {
    const spaceId = await freshSpace();
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'rateLimits.delivery.space', {
      max: 1,
      windowSeconds: 60,
    });
    await hit(spaceId, 'w');
    expect(await hit(spaceId, 'w')).toMatchObject({ allowed: false });
    await ctx.controls.set({ kind: 'space', id: spaceId }, 'rateLimits.delivery.space', {
      max: 1,
      windowSeconds: 120,
    });
    expect(await hit(spaceId, 'w')).toMatchObject({ allowed: true });
  });

  it('lets requests through when the store fails', async () => {
    const spaceId = await freshSpace();
    ctx.controlStore.rates = {
      consume: () => {
        throw new Error('redis down');
      },
      acquire: () => {
        throw new Error('redis down');
      },
      release: () => {},
    };
    expect(await ctx.controlStore.rate(spaceId, [{ rule: 'delivery.ip', key: 'x' }])).toBeNull();
    await ctx.controls.set({ kind: 'instance' }, 'rateLimits.plugins.queue.jobs', { max: 1 });
    expect(await ctx.controlStore.acquire(spaceId, 'plugins.queue.jobs', 1_000)).not.toBeNull();
  });
});

describe('concurrency slots', () => {
  it('pools a group value across its spaces and keeps a space value per space', async () => {
    const [a, b, c] = [await freshSpace(), await freshSpace(), await freshSpace()];
    const group = await ctx.controls.createGroup({ name: `rl-pool-${counter}` });
    await ctx.controls.assignSpaces({ id: group.id }, [a, b]);
    await ctx.controls.set({ kind: 'group', id: group.id }, 'rateLimits.plugins.queue.jobs', {
      max: 1,
    });

    const held = await ctx.controlStore.acquire(a, 'plugins.queue.jobs', 60_000);
    expect(held).not.toBeNull();
    expect(await ctx.controlStore.acquire(b, 'plugins.queue.jobs', 60_000)).toBeNull();
    // Unlimited outside the group.
    expect(await ctx.controlStore.acquire(c, 'plugins.queue.jobs', 60_000)).not.toBeNull();
    await held?.release();
    expect(await ctx.controlStore.acquire(b, 'plugins.queue.jobs', 60_000)).not.toBeNull();

    await ctx.controls.set({ kind: 'space', id: c }, 'rateLimits.plugins.queue.jobs', {
      max: 0,
    });
    expect(await ctx.controlStore.acquire(c, 'plugins.queue.jobs', 60_000)).toBeNull();
  });
});
