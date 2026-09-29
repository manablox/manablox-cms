import { randomUUID } from 'node:crypto';
import { createRedis } from '@manablox/cache';
import { type ControlScope, ManabloxError, scopeLabel, usagePeriod } from '@manablox/core';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  USAGE_BASELINE_META_KEY,
  USAGE_STATE_STALE_MS,
  type UsageStateOptions,
  UsageStateStore,
  type UsageTransition,
} from '../src/controls/index.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let counter = 0;

beforeAll(async () => {
  ctx = await createServiceContext('usage_state', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

/** Settings written by a test, removed after it. */
const written: Array<{ scope: ControlScope; key: string }> = [];
afterEach(async () => {
  for (const { scope, key } of written.splice(0)) await ctx.controls.delete(scope, key);
});

const freshSpace = async () => {
  const name = `state-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://s.test' })).id;
};

const space = (id: string): ControlScope => ({ kind: 'space', id });
const period = () => usagePeriod(new Date()).label;

async function limit(
  scope: ControlScope,
  metric: string,
  value: { max: number | null; mode: 'hard' | 'soft' | 'off'; thresholds?: number[] },
) {
  await ctx.controls.set(scope, `usage.${metric}`, value);
  written.push({ scope, key: `usage.${metric}` });
}

const use = (spaceId: string, metric: string, amount: number, label = period()) =>
  ctx.repos.usageCounters.increment({ scope: space(spaceId), metric, period: label }, amount);

function store(options: Partial<UsageStateOptions> = {}) {
  const state = new UsageStateStore(ctx.manablox, ctx.repos, {
    anchorDay: async () => 1,
    owner: true,
    ...options,
  });
  const seen: UsageTransition[] = [];
  state.onTransition((transition) => {
    seen.push(transition);
  });
  return { state, seen };
}

/** Transitions of one scope, without those of other tests' scopes. */
const of = (transitions: UsageTransition[], scope: ControlScope) =>
  transitions
    .filter((entry) => scopeLabel(entry.scope) === scopeLabel(scope))
    .map(({ metric, from, to, threshold, used, max }) => ({
      metric,
      from,
      to,
      threshold,
      used,
      max,
    }))
    .sort((a, b) => a.metric.localeCompare(b.metric));

describe('the usage state evaluator', () => {
  it('computes levels per scope and metric and reports each crossing once', async () => {
    const spaceId = await freshSpace();
    await limit(space(spaceId), 'apiRequests', { max: 10, mode: 'hard', thresholds: [50, 80] });
    await limit(space(spaceId), 'mails', { max: 4, mode: 'soft' });
    const { state, seen } = store();

    await use(spaceId, 'apiRequests', 4);
    await state.evaluate();
    expect(of(seen, space(spaceId))).toEqual([]);
    expect((await state.scope(space(spaceId))).apiRequests).toMatchObject({
      level: 'ok',
      used: 4,
      max: 10,
      threshold: null,
    });

    await use(spaceId, 'apiRequests', 1);
    await use(spaceId, 'mails', 4);
    await state.evaluate();
    expect(of(seen, space(spaceId))).toEqual([
      { metric: 'apiRequests', from: 'ok', to: 'warn', threshold: 50, used: 5, max: 10 },
      { metric: 'mails', from: 'ok', to: 'warn', threshold: 100, used: 4, max: 4 },
    ]);

    // Nothing crossed: nothing reported.
    seen.length = 0;
    await state.evaluate();
    expect(of(seen, space(spaceId))).toEqual([]);

    await use(spaceId, 'apiRequests', 3);
    await use(spaceId, 'mails', 1);
    await state.evaluate();
    expect(of(seen, space(spaceId))).toEqual([
      { metric: 'apiRequests', from: 'warn', to: 'warn', threshold: 80, used: 8, max: 10 },
      { metric: 'mails', from: 'warn', to: 'over', threshold: 100, used: 5, max: 4 },
    ]);

    seen.length = 0;
    await use(spaceId, 'apiRequests', 2);
    await state.evaluate();
    expect(of(seen, space(spaceId))).toEqual([
      { metric: 'apiRequests', from: 'warn', to: 'blocked', threshold: 80, used: 10, max: 10 },
    ]);
    expect(await state.blocked([space(spaceId)], 'apiRequests')).toMatchObject({
      scope: space(spaceId),
      used: 10,
      max: 10,
    });
    expect(await state.blocked([space(spaceId)], 'mails')).toBeNull();
  });

  it('keeps its baseline across processes, so a restart reports nothing again', async () => {
    const spaceId = await freshSpace();
    await limit(space(spaceId), 'uploads', { max: 2, mode: 'hard' });
    await use(spaceId, 'uploads', 2);
    const first = store();
    await first.state.evaluate();
    expect(of(first.seen, space(spaceId))).toHaveLength(1);

    const second = store();
    await second.state.evaluate();
    expect(of(second.seen, space(spaceId))).toEqual([]);
    const baseline =
      await ctx.repos.instanceMeta.get<Record<string, unknown>>(USAGE_BASELINE_META_KEY);
    expect(baseline?.[scopeLabel(space(spaceId))]).toMatchObject({
      uploads: { level: 'blocked', period: period() },
    });

    // Raising the limit reports the way down.
    await limit(space(spaceId), 'uploads', { max: 100, mode: 'hard' });
    await second.state.evaluate();
    expect(of(second.seen, space(spaceId))).toEqual([
      { metric: 'uploads', from: 'blocked', to: 'ok', threshold: null, used: 2, max: 100 },
    ]);
  });

  it('adds external usage and sums a group and the instance over their spaces', async () => {
    const [one, two] = [await freshSpace(), await freshSpace()];
    const group = await ctx.controls.createGroup({ name: `g-${randomUUID()}` });
    await ctx.controls.assignSpaces({ id: group.id }, [one, two]);
    const groupScope: ControlScope = { kind: 'group', id: group.id };
    // Deleted with the group.
    await ctx.controls.set(groupScope, 'usage.bandwidthBytes', { max: 1000, mode: 'hard' });
    await use(one, 'bandwidthBytes', 400);
    await ctx.repos.usageExternal.insert({
      idempotencyKey: randomUUID(),
      spaceId: two,
      metric: 'bandwidthBytes',
      period: period(),
      value: 600,
      mode: 'add',
    });
    await ctx.controlStore.usageState?.evaluate();

    // The group blocks both spaces; only the space-level scope is asked about.
    for (const spaceId of [one, two]) {
      expect(await ctx.manablox.controls.usageBlocked(spaceId, 'bandwidthBytes')).toMatchObject({
        scope: groupScope,
        used: 1000,
        max: 1000,
      });
    }
    const outside = await freshSpace();
    expect(await ctx.manablox.controls.usageBlocked(outside, 'bandwidthBytes')).toBeNull();

    // An instance limit reaches every space; other tests' mails count at the instance too.
    await limit({ kind: 'instance' }, 'mails', { max: 1, mode: 'hard' });
    await use(outside, 'mails', 1);
    await ctx.controlStore.usageState?.evaluate();
    const error = await ctx.manablox.controls.assertUsage(one, 'mails').then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(ManabloxError.is(error) && error.key).toBe('control.usage');
    expect(ManabloxError.is(error) && error.status).toBe(429);
    expect(ManabloxError.is(error) && error.details[0]?.params).toMatchObject({
      metric: 'mails',
      scope: 'instance',
      used: expect.any(Number),
      max: 1,
    });
    expect(await ctx.manablox.controls.usageNotices(two)).toMatchObject({
      mails: { level: 'blocked', scope: { kind: 'instance' } },
      bandwidthBytes: { level: 'blocked', scope: groupScope },
    });
    await ctx.controls.deleteGroup({ id: group.id });
  });

  it('lets a state from an earlier period block nothing', async () => {
    const spaceId = await freshSpace();
    await limit(space(spaceId), 'uploads', { max: 1, mode: 'hard' });
    let now = new Date('2026-03-20T12:00:00Z').getTime();
    const { state, seen } = store({ now: () => now, owner: false });
    await use(spaceId, 'uploads', 1, '2026-03');
    await state.evaluate();
    expect(await state.blocked([space(spaceId)], 'uploads')).not.toBeNull();
    // Not an owner: nothing reported.
    expect(seen).toEqual([]);
    now = new Date('2026-04-01T00:00:00Z').getTime();
    expect(await state.blocked([space(spaceId)], 'uploads')).toBeNull();
    await state.evaluate();
    expect((await state.scope(space(spaceId))).uploads).toMatchObject({
      level: 'ok',
      used: 0,
      period: '2026-04',
    });
  });

  it('purges a space once when apiRequests become blocked', async () => {
    const spaceId = await freshSpace();
    await limit(space(spaceId), 'apiRequests', { max: 1, mode: 'hard' });
    const purged: string[][] = [];
    const off = ctx.manablox.hooks.on('cache:purge', ({ tags }) => {
      purged.push(tags);
    });
    try {
      const { state } = store();
      await use(spaceId, 'apiRequests', 1);
      await state.evaluate();
      await state.evaluate();
      expect(purged.filter((tags) => tags.includes(`space:${spaceId}`))).toEqual([
        [`space:${spaceId}`],
      ]);
    } finally {
      off();
    }
  });
});

/** A Redis double whose reads succeed or fail on demand. */
function fakeRedis(hashes: Map<string, Record<string, string>>) {
  const calls = { reads: 0, fail: false };
  const redis = {
    pipeline() {
      const keys: string[] = [];
      const pipe = {
        hgetall(key: string) {
          keys.push(key);
          return pipe;
        },
        async exec() {
          calls.reads++;
          if (calls.fail) throw new Error('redis away');
          return keys.map((key) => [null, hashes.get(key) ?? {}]);
        },
      };
      return pipe;
    },
  };
  return { redis: redis as never, calls };
}

describe('reading the state on hot paths', () => {
  const prefix = 'fake:';
  const blockedState = (spaceId: string) =>
    new Map([
      [
        `${prefix}space:${spaceId}`,
        {
          apiRequests: JSON.stringify({
            level: 'blocked',
            used: 5,
            max: 5,
            resetsAt: '2999-01-01T00:00:00.000Z',
            period: '2998-12',
            threshold: 100,
          }),
        },
      ],
    ]);

  it('reads Redis at most once per 5 seconds and keeps the last state through an outage', async () => {
    const spaceId = randomUUID();
    const { redis, calls } = fakeRedis(blockedState(spaceId));
    let now = 1_000_000;
    const { state } = store({ redis, prefix, owner: false, now: () => now });
    const chain = [space(spaceId)];

    expect(await state.blocked(chain, 'apiRequests')).not.toBeNull();
    expect(await state.blocked(chain, 'apiRequests')).not.toBeNull();
    expect(calls.reads).toBe(1);
    now += 5001;
    expect(await state.blocked(chain, 'apiRequests')).not.toBeNull();
    expect(calls.reads).toBe(2);

    calls.fail = true;
    now += 5001;
    expect(await state.blocked(chain, 'apiRequests')).not.toBeNull();
    now += USAGE_STATE_STALE_MS - 6000;
    expect(await state.blocked(chain, 'apiRequests')).not.toBeNull();

    // Five minutes without a fresh read: fail open, logged once.
    const warnings: unknown[] = [];
    const original = ctx.manablox.logger.warn;
    ctx.manablox.logger.warn = ((...args: unknown[]) => {
      warnings.push(args);
    }) as typeof original;
    try {
      now += 2000;
      expect(await state.blocked(chain, 'apiRequests')).toBeNull();
      now += 6000;
      expect(await state.blocked(chain, 'apiRequests')).toBeNull();
      expect(warnings).toHaveLength(1);
    } finally {
      ctx.manablox.logger.warn = original;
    }

    // Back: enforced again.
    calls.fail = false;
    now += 6000;
    expect(await state.blocked(chain, 'apiRequests')).not.toBeNull();
  });

  it('fails open after 5 minutes without an evaluation when there is no Redis', async () => {
    const spaceId = await freshSpace();
    await limit(space(spaceId), 'uploads', { max: 1, mode: 'hard' });
    await use(spaceId, 'uploads', 1);
    let now = Date.now();
    const { state } = store({ owner: false, now: () => now });
    await state.evaluate();
    expect(await state.blocked([space(spaceId)], 'uploads')).not.toBeNull();
    now += USAGE_STATE_STALE_MS + 1;
    expect(await state.blocked([space(spaceId)], 'uploads')).toBeNull();
  });

  it('skips the state when no scope of the space limits the metric', async () => {
    const spaceId = await freshSpace();
    const original = ctx.controlStore.usageState;
    let asked = 0;
    ctx.controlStore.usageState = {
      blocked: async () => {
        asked++;
        return null;
      },
    } as never;
    try {
      expect(await ctx.manablox.controls.usageBlocked(spaceId, 'mails')).toBeNull();
      expect(asked).toBe(0);
    } finally {
      ctx.controlStore.usageState = original;
    }
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('the usage state over Redis', () => {
  const prefix = `test:usage-state:${randomUUID()}:`;
  const clients: Array<ReturnType<typeof createRedis>> = [];
  const client = () => {
    const redis = createRedis(redisUrl, 'command');
    clients.push(redis);
    return redis;
  };
  afterAll(async () => {
    const admin = client();
    const keys = await admin.keys(`${prefix}*`);
    if (keys.length > 0) await admin.del(...keys);
    await Promise.all(clients.map((redis) => redis.quit().catch(() => {})));
  });

  it('publishes one hash per scope that other processes read', async () => {
    const spaceId = await freshSpace();
    await limit(space(spaceId), 'uploads', { max: 3, mode: 'hard' });
    await use(spaceId, 'uploads', 3);
    const writer = store({ redis: client(), prefix });
    await writer.state.evaluate();

    const hash = await client().hgetall(`${prefix}space:${spaceId}`);
    expect(JSON.parse(hash.uploads ?? '{}')).toMatchObject({
      level: 'blocked',
      used: 3,
      max: 3,
    });
    const reader = store({ redis: client(), prefix, owner: false });
    expect(await reader.state.blocked([space(spaceId)], 'uploads')).toMatchObject({
      used: 3,
      max: 3,
    });

    // A removed limit drops the scope's hash.
    await ctx.controls.delete(space(spaceId), 'usage.uploads');
    await writer.state.evaluate();
    expect(await client().exists(`${prefix}space:${spaceId}`)).toBe(0);
  });
});
