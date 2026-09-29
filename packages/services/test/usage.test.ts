import { randomUUID } from 'node:crypto';
import { createRedis } from '@manablox/cache';
import { ManabloxError, type RequestServed } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsageMeter, UsageReports } from '../src/controls/index.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let counter = 0;

beforeAll(async () => {
  ctx = await createServiceContext('usage', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const freshSpace = async (url = 'http://u.test') => {
  const name = `use-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url })).id;
};

const at = (iso: string) => () => new Date(iso).getTime();

const counted = (spaceId: string, metric: string, period: string) =>
  ctx.repos.usageCounters.get({ scope: { kind: 'space', id: spaceId }, metric, period });

async function failure(run: Promise<unknown>): Promise<ManabloxError> {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!ManabloxError.is(error)) throw new Error(`expected a ManabloxError, got ${String(error)}`);
  return error;
}

describe('the usage meter without Redis', () => {
  it('adds counts in process and writes them on flush', async () => {
    const spaceId = await freshSpace();
    const meter = new UsageMeter(ctx.manablox, ctx.repos, { now: at('2026-09-10T12:00:00Z') });
    for (let i = 0; i < 5; i++) meter.consume(spaceId, 'apiRequests', 1);
    meter.consume(spaceId, 'bandwidthBytes', 1200);
    meter.consume(spaceId, 'bandwidthBytes', 0);
    meter.consume(spaceId, 'bandwidthBytes', Number.NaN);
    expect(await counted(spaceId, 'apiRequests', '2026-09')).toBe(0);

    ctx.resetQueryCount();
    await meter.flush();
    expect(ctx.queryCount()).toBe(1);
    expect(await counted(spaceId, 'apiRequests', '2026-09')).toBe(5);
    expect(await counted(spaceId, 'bandwidthBytes', '2026-09')).toBe(1200);

    meter.consume(spaceId, 'apiRequests', 2);
    await meter.flush();
    await meter.flush();
    expect(await counted(spaceId, 'apiRequests', '2026-09')).toBe(7);
  });

  it('keeps counts when the write fails and writes the rest on close', async () => {
    const spaceId = await freshSpace();
    const meter = new UsageMeter(ctx.manablox, ctx.repos, { now: at('2026-09-10T12:00:00Z') });
    meter.consume(spaceId, 'uploads', 1);
    const original = ctx.repos.usageCounters.incrementMany;
    ctx.repos.usageCounters.incrementMany = async () => {
      throw new Error('database away');
    };
    try {
      await expect(meter.flush()).rejects.toThrow('database away');
    } finally {
      ctx.repos.usageCounters.incrementMany = original;
    }
    meter.consume(spaceId, 'uploads', 1);
    await meter.close();
    meter.consume(spaceId, 'uploads', 1);
    expect(await counted(spaceId, 'uploads', '2026-09')).toBe(2);
  });

  it('labels periods with the instance anchor day', async () => {
    const spaceId = await freshSpace();
    let now = new Date('2026-09-10T12:00:00Z').getTime();
    const meter = new UsageMeter(ctx.manablox, ctx.repos, {
      now: () => now,
      anchorDay: async () => (await ctx.controlStore.resolved(null)).usage.periodAnchorDay,
    });
    await ctx.controls.set({ kind: 'instance' }, 'usagePeriodAnchorDay', 15);
    try {
      await meter.refreshAnchor();
      // Before the 15th the period started in August.
      meter.consume(spaceId, 'mails', 1);
      now = new Date('2026-09-15T00:00:00Z').getTime();
      meter.consume(spaceId, 'mails', 2);
      expect(meter.currentPeriod()).toBe('2026-09');
      await meter.flush();
      expect(await counted(spaceId, 'mails', '2026-08')).toBe(1);
      expect(await counted(spaceId, 'mails', '2026-09')).toBe(2);

      await ctx.controls.delete({ kind: 'instance' }, 'usagePeriodAnchorDay');
      await meter.refreshAnchor();
      now = new Date('2026-10-01T00:00:00Z').getTime();
      expect(meter.currentPeriod()).toBe('2026-10');
    } finally {
      await ctx.controls.delete({ kind: 'instance' }, 'usagePeriodAnchorDay');
    }
  });

  it('counts through manablox.controls once installed', async () => {
    const spaceId = await freshSpace();
    ctx.manablox.controls.consume(spaceId, 'mails', 3);
    await ctx.controlStore.usage?.flush();
    expect(await counted(spaceId, 'mails', period())).toBe(3);
  });
});

/** The current calendar period; the instance anchor is the default. */
const period = () => new Date().toISOString().slice(0, 7);

describe('metering from hooks', () => {
  const served = (payload: RequestServed) =>
    ctx.manablox.hooks.observe('request:served', payload, {
      manablox: ctx.manablox,
      spaceId: payload.spaceId,
    });

  it('counts requests and bytes by surface, cache hits included, and spaceless ones apart', async () => {
    const spaceId = await freshSpace();
    const unattributed = (metric: string) =>
      ctx.repos.usageCounters.get({ scope: { kind: 'instance' }, metric, period: period() });
    const before = {
      requests: await unattributed('apiRequests'),
      bytes: await unattributed('bandwidthBytes'),
    };
    const base = { spaceId, status: 200, cached: false };
    await served({ ...base, surface: 'delivery', bytes: 100 });
    await served({ ...base, surface: 'delivery', status: 304, bytes: 0, cached: true });
    await served({ ...base, surface: 'delivery', bytes: 40, cached: true });
    await served({ ...base, surface: 'management', bytes: 1000 });
    await served({ ...base, surface: 'media', bytes: 5000, cached: true });
    await served({ ...base, surface: 'site', bytes: 700 });
    await served({ ...base, spaceId: null, surface: 'media', bytes: 9999 });
    await served({ ...base, spaceId: null, surface: 'delivery', bytes: 1 });
    await ctx.controlStore.usage?.flush();

    expect(await counted(spaceId, 'apiRequests', period())).toBe(4);
    expect(await counted(spaceId, 'bandwidthBytes', period())).toBe(100 + 40 + 5000 + 700);
    expect(await unattributed('apiRequests')).toBe(before.requests + 1);
    expect(await unattributed('bandwidthBytes')).toBe(before.bytes + 10000);
  });

  it("counts mails sent through the instance, not editors' own mailboxes", async () => {
    const spaceId = await freshSpace();
    const sent = (transport: 'instance' | 'account', recipients: number, space: string | null) =>
      ctx.manablox.hooks.observe(
        'mail:afterSend',
        { spaceId: space, kind: 'notification', recipients, transport },
        { manablox: ctx.manablox, spaceId: space },
      );
    await sent('instance', 3, spaceId);
    await sent('account', 5, spaceId);
    await sent('instance', 1, null);
    await ctx.controlStore.usage?.flush();
    expect(await counted(spaceId, 'mails', period())).toBe(3);
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('the usage meter over Redis', () => {
  const prefix = `test:usage:${randomUUID()}:`;
  const clients: Array<ReturnType<typeof createRedis>> = [];
  const meter = (now = at('2026-09-10T12:00:00Z')) => {
    const redis = createRedis(redisUrl, 'command');
    clients.push(redis);
    return new UsageMeter(ctx.manablox, ctx.repos, { redis, prefix, now });
  };
  afterAll(async () => {
    const admin = createRedis(redisUrl, 'command');
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length > 0) await admin.del(...keys);
    await admin.quit();
    await Promise.all(clients.map((client) => client.quit().catch(() => {})));
  });

  it('hands counts to one hash and flushes it into the database', async () => {
    const spaceId = await freshSpace();
    const one = meter();
    one.consume(spaceId, 'apiRequests', 2);
    one.consume(spaceId, 'bandwidthBytes', 300);
    const instance = {
      scope: { kind: 'instance' as const },
      metric: 'apiRequests',
      period: '2026-09',
    };
    const unattributed = await ctx.repos.usageCounters.get(instance);
    one.consume(null, 'apiRequests', 4);
    await one.flush();
    expect(await counted(spaceId, 'apiRequests', '2026-09')).toBe(2);
    expect(await counted(spaceId, 'bandwidthBytes', '2026-09')).toBe(300);
    expect(await ctx.repos.usageCounters.get(instance)).toBe(unattributed + 4);

    const inspect = createRedis(redisUrl, 'command');
    clients.push(inspect);
    expect(await inspect.keys(`${prefix}*`)).toEqual([]);
  });

  it('loses no count across two processes flushing while they count', async () => {
    const spaceId = await freshSpace();
    const [one, two] = [meter(), meter()];
    one.start();
    two.start();
    let expected = 0;
    const flushes: Promise<void>[] = [];
    for (let round = 0; round < 40; round++) {
      one.consume(spaceId, 'apiRequests', 1);
      two.consume(spaceId, 'apiRequests', 2);
      expected += 3;
      if (round % 5 === 0) flushes.push(round % 10 === 0 ? one.flush() : two.flush());
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await Promise.all(flushes);
    await one.close();
    await two.close();
    await meter().flush();
    expect(await counted(spaceId, 'apiRequests', '2026-09')).toBe(expected);
  });

  it('takes over a flushing hash left by a flush that died', async () => {
    const spaceId = await freshSpace();
    const redis = createRedis(redisUrl, 'command');
    clients.push(redis);
    const stale = `${prefix}flushing:${new Date('2026-09-10T11:00:00Z').getTime()}:dead`;
    const fresh = `${prefix}flushing:${new Date('2026-09-10T11:59:00Z').getTime()}:running`;
    await redis.hset(stale, `2026-09:${spaceId}:uploads`, '4');
    await redis.hset(fresh, `2026-09:${spaceId}:uploads`, '8');

    await meter().flush();
    expect(await counted(spaceId, 'uploads', '2026-09')).toBe(4);
    expect(await redis.exists(stale)).toBe(0);
    expect(await redis.exists(fresh)).toBe(1);
    await redis.del(fresh);
  });

  it('counts a batch once when its hash outlives the commit', async () => {
    const spaceId = await freshSpace();
    const redis = createRedis(redisUrl, 'command');
    clients.push(redis);
    const del = redis.del.bind(redis);
    redis.del = (() => Promise.reject(new Error('redis away'))) as never;
    const first = new UsageMeter(ctx.manablox, ctx.repos, {
      redis,
      prefix,
      now: at('2026-09-10T12:00:00Z'),
    });
    first.consume(spaceId, 'uploads', 5);
    await expect(first.flush()).rejects.toThrow('redis away');
    expect(await counted(spaceId, 'uploads', '2026-09')).toBe(5);
    redis.del = del;
    expect(await redis.keys(`${prefix}flushing:*`)).toHaveLength(1);

    // Later than the orphan wait, so the next flush takes the hash over.
    await meter(at('2026-09-10T12:06:00Z')).flush();
    expect(await counted(spaceId, 'uploads', '2026-09')).toBe(5);
    expect(await redis.keys(`${prefix}flushing:*`)).toEqual([]);
  });
});

describe('usage reports', () => {
  const reports = () => new UsageReports(ctx.manablox, ctx.repos);
  const report = (input: Partial<Parameters<UsageReports['external']>[0]>) =>
    reports().external({
      idempotencyKey: randomUUID(),
      metric: 'bandwidthBytes',
      period: '2026-09',
      value: 100,
      mode: 'add',
      ...input,
    });

  it('adds, replaces with set and keeps later adds', async () => {
    const spaceId = await freshSpace();
    expect(await report({ spaceId, value: 100 })).toMatchObject({
      spaceId,
      duplicate: false,
      external: 100,
    });
    expect((await report({ spaceId, value: 50 })).external).toBe(150);
    expect((await report({ spaceId, value: 1000, mode: 'set' })).external).toBe(1000);
    expect((await report({ spaceId, value: 5 })).external).toBe(1005);
    expect((await report({ spaceId, value: 7, period: '2026-10' })).external).toBe(7);
  });

  it('stores a key once and refuses it with other values', async () => {
    const spaceId = await freshSpace();
    const idempotencyKey = randomUUID();
    await report({ spaceId, idempotencyKey, value: 10 });
    expect(await report({ spaceId, idempotencyKey, value: 10 })).toMatchObject({
      duplicate: true,
      external: 10,
    });
    const mismatch = await failure(report({ spaceId, idempotencyKey, value: 11 }));
    expect(mismatch.key).toBe('control.idempotency.mismatch');

    expect(
      await ctx.repos.audit.count({ spaceId, actions: ['usage.external'], actorKind: 'control' }),
    ).toBe(1);
  });

  it('resolves a host through host sources, then frontend URLs', async () => {
    const byDomain = await freshSpace();
    await ctx.repos.spaceApiHosts.create(byDomain, { hostname: 'cdn-usage.example.com' });
    const byUrl = await freshSpace('https://front-usage.example.org/app');

    expect((await report({ host: 'CDN-usage.example.com' })).spaceId).toBe(byDomain);
    expect((await report({ host: 'front-usage.example.org' })).spaceId).toBe(byUrl);
    expect((await failure(report({ host: 'nobody.example.net' }))).key).toBe('space.notFound');
    expect((await failure(report({ spaceId: randomUUID() }))).key).toBe('space.notFound');
    expect((await failure(report({ spaceId: byUrl, period: '2026-13' }))).kind).toBe('validation');
  });

  it('sums counted and external usage per scope with the limit set there', async () => {
    const [a, b, outside] = [await freshSpace(), await freshSpace(), await freshSpace()];
    const group = await ctx.controls.createGroup({ name: `usage-${randomUUID()}` });
    await ctx.controls.assignSpaces({ id: group.id }, [a, b]);
    const increment = (spaceId: string, metric: string, delta: number) =>
      ctx.repos.usageCounters.increment(
        { scope: { kind: 'space', id: spaceId }, metric, period: '2026-07' },
        delta,
      );
    await increment(a, 'apiRequests', 10);
    await increment(b, 'apiRequests', 20);
    await increment(outside, 'apiRequests', 1000);
    await increment(a, 'uploads', 3);
    await report({ spaceId: b, metric: 'apiRequests', value: 70, period: '2026-07' });
    await ctx.controls.set({ kind: 'group', id: group.id }, 'usage.apiRequests', {
      max: 100,
      mode: 'hard',
    });

    const grouped = await reports().report({ kind: 'group', id: group.id }, '2026-07');
    expect(grouped).toMatchObject({
      scope: `group:${group.id}`,
      period: '2026-07',
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    });
    expect(grouped.metrics.apiRequests).toEqual({
      counted: 30,
      external: 70,
      total: 100,
      limit: { max: 100, mode: 'hard', thresholds: [80, 100] },
      state: 'blocked',
    });
    expect(grouped.metrics.uploads).toMatchObject({ counted: 3, limit: null, state: null });
    expect(Object.keys(grouped.metrics).sort()).toEqual(
      ['apiRequests', 'bandwidthBytes', 'mails', 'uploads'].sort(),
    );

    const space = await reports().report({ kind: 'space', id: a }, '2026-07');
    expect(space.metrics.apiRequests).toMatchObject({ counted: 10, external: 0, limit: null });
    expect(space.unattributed).toBeNull();
    expect(grouped.unattributed).toBeNull();
    await ctx.repos.usageCounters.increment(
      { scope: { kind: 'instance' }, metric: 'apiRequests', period: '2026-07' },
      5,
    );
    const instance = await reports().report({ kind: 'instance' }, '2026-07');
    expect(instance.metrics.apiRequests.total).toBeGreaterThanOrEqual(1100);
    expect(instance.unattributed).toMatchObject({ apiRequests: 5, mails: 0 });
    await ctx.controls.deleteGroup({ id: group.id });
  });
});
