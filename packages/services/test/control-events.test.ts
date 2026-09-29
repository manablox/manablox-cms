import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRedis } from '@manablox/cache';
import type { ControlEventRow, Repositories } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTROL_SIGNATURE_HEADER,
  ControlEventDelivery,
  ControlEvents,
  controlEventView,
  pruneControlEvents,
  signControlEvents,
  usageTransitionEvents,
} from '../src/controls/index.js';
import { createServiceContext, type ServiceContext, withControls } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
let counter = 0;

beforeAll(async () => {
  ctx = await createServiceContext('control_events', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const name = () => `ev-${++counter}-${randomUUID().slice(0, 8)}`;

const freshSpace = async () => {
  const machineName = name();
  return ctx.spaces.create({ name: machineName, machineName, url: 'http://ev.test' }, null);
};

const freshUser = async () =>
  ctx.repos.users.create({
    name: 'U',
    email: `${name()}@example.test`,
    role: 'editor',
    passwordHash: 'x',
  });

/** Events written after `mark`, oldest first. */
const since = (mark: number) => ctx.repos.controlEvents.listAfter(mark, 1000);

const mark = () => ctx.repos.controlEvents.latestSeq();

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const shape = (row: ControlEventRow) => ({
  type: row.type,
  scope: controlEventView(row).scope,
  payload: row.payload,
});

describe('lifecycle events', () => {
  it('records space.created with the owner seat and space.deleted', async () => {
    const owner = await freshUser();
    const start = await mark();
    const machineName = name();
    const space = await ctx.spaces.create(
      { name: 'Events', machineName, url: 'http://ev.test' },
      owner.id,
    );
    await ctx.spaces.delete(space.id);

    expect((await since(start)).map(shape)).toEqual([
      {
        type: 'space.created',
        scope: `space:${space.id}`,
        payload: { spaceId: space.id, name: 'Events', machineName, groupId: null },
      },
      {
        type: 'seat.changed',
        scope: `space:${space.id}`,
        payload: { spaceId: space.id, change: 'added', userIds: [owner.id], members: 1 },
      },
      {
        type: 'space.deleted',
        scope: `space:${space.id}`,
        payload: { spaceId: space.id, name: 'Events', machineName, groupId: null },
      },
    ]);
  });

  it('writes nothing when the cause rolls back', async () => {
    const start = await mark();
    const machineName = name();
    await expect(
      ctx.spaces.create({ name: 'Gone', machineName, url: 'http://ev.test' }, null, async () => {
        throw new Error('fill failed');
      }),
    ).rejects.toThrow('fill failed');
    expect(await since(start)).toEqual([]);
  });

  it('records seat changes with the member count', async () => {
    const space = await freshSpace();
    const [a, b, c] = [await freshUser(), await freshUser(), await freshUser()];
    const start = await mark();
    await ctx.spaces.addMembers(space.id, [a.id, b.id], 'editor');
    await ctx.spaces.grant(space.id, c.id, 'viewer');
    // A role change is no seat change.
    await ctx.spaces.grant(space.id, c.id, 'editor');
    await ctx.spaces.revoke(space.id, a.id);

    const scope = `space:${space.id}`;
    expect((await since(start)).map(shape)).toEqual([
      {
        type: 'seat.changed',
        scope,
        payload: { spaceId: space.id, change: 'added', userIds: [a.id, b.id], members: 2 },
      },
      {
        type: 'seat.changed',
        scope,
        payload: { spaceId: space.id, change: 'added', userIds: [c.id], members: 3 },
      },
      {
        type: 'seat.changed',
        scope,
        payload: { spaceId: space.id, change: 'removed', userIds: [a.id], members: 2 },
      },
    ]);
  });

  it('records group changes on assignment, replacement and group deletion', async () => {
    const [one, two] = [await freshSpace(), await freshSpace()];
    const first = await ctx.controls.createGroup({ name: 'First', externalId: name() });
    const second = await ctx.controls.createGroup({ name: 'Second' });
    const ref = (group: typeof first) => ({ id: group.id, externalId: group.externalId });
    const start = await mark();

    await ctx.controls.assignSpaces({ id: first.id }, [one.id, two.id]);
    await ctx.controls.assignSpaces({ id: second.id }, [one.id]);
    await ctx.controls.assignSpaces({ id: first.id }, [], { replace: true });
    await ctx.controls.deleteGroup({ id: second.id });

    const events = (await since(start)).map(shape);
    expect(events.every((event) => event.type === 'space.groupChanged')).toBe(true);
    expect(events).toHaveLength(5);
    // Spaces moved by one call come in no fixed order.
    expect(events.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        { spaceId: one.id, from: null, to: ref(first) },
        { spaceId: two.id, from: null, to: ref(first) },
        { spaceId: one.id, from: ref(first), to: ref(second) },
        { spaceId: two.id, from: ref(first), to: null },
        { spaceId: one.id, from: ref(second), to: null },
      ]),
    );
  });

  it('records instance.stateChanged only when the state changes', async () => {
    const start = await mark();
    await ctx.controls.set({ kind: 'instance' }, 'state', { status: 'readOnly', message: 'Busy' });
    await ctx.controls.set({ kind: 'instance' }, 'state', { status: 'readOnly', message: 'Busy' });
    await ctx.controls.delete({ kind: 'instance' }, 'state');

    expect((await since(start)).map(shape)).toEqual([
      {
        type: 'instance.stateChanged',
        scope: 'instance',
        payload: { from: null, to: { status: 'readOnly', message: 'Busy' } },
      },
      {
        type: 'instance.stateChanged',
        scope: 'instance',
        payload: { from: { status: 'readOnly', message: 'Busy' }, to: null },
      },
    ]);
  });

  it('records API hosts added and removed', async () => {
    const space = await freshSpace();
    const start = await mark();
    const row = await ctx.apiHosts.create(space.id, `${name()}.example.test`);
    await ctx.apiHosts.delete(space.id, row.id);

    const payload = {
      spaceId: space.id,
      environmentId: row.environmentId,
      environment: 'production',
      domainId: row.id,
      hostname: row.hostname,
      kind: 'api',
    };
    expect((await since(start)).map((event) => [event.type, event.payload])).toEqual([
      ['domain.added', payload],
      ['domain.removed', payload],
    ]);
  });
});

describe('refusals and soft limits', () => {
  it('samples feature.denied per scope and feature', async () => {
    const space = await freshSpace();
    const scope = { kind: 'space' as const, id: space.id };
    const restore = await withControls(ctx, { scope, features: { customDomains: false } });
    try {
      const start = await mark();
      for (let i = 0; i < 3; i++) {
        await expect(
          ctx.controlStore.assertFeature(space.id, 'customDomains'),
        ).rejects.toMatchObject({ key: 'control.feature' });
      }
      const events = await eventually(
        () => since(start),
        (rows) => rows.length > 0,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await since(start)).map(shape)).toEqual([
        {
          type: 'feature.denied',
          scope: `space:${space.id}`,
          payload: { feature: 'customDomains', spaceId: space.id },
        },
      ]);
      expect(events).toHaveLength(1);
    } finally {
      await restore();
    }
  });

  it('samples limit.blocked and emits limit.exceeded once when a soft limit is crossed', async () => {
    const used = (await ctx.repos.spaces.list()).length;
    const restoreHard = await withControls(ctx, {
      values: { 'limits.spaces': { max: used, mode: 'hard' } },
    });
    const start = await mark();
    try {
      for (let i = 0; i < 2; i++) {
        await expect(freshSpace()).rejects.toMatchObject({ key: 'control.limit' });
      }
      await eventually(
        () => since(start),
        (rows) => rows.length > 0,
      );
    } finally {
      await restoreHard();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await since(start)).map(shape)).toEqual([
      {
        type: 'limit.blocked',
        scope: 'instance',
        payload: { limit: 'spaces', used, max: used, spaceId: null },
      },
    ]);

    const restoreSoft = await withControls(ctx, {
      values: { 'limits.spaces': { max: used, mode: 'soft' } },
    });
    try {
      const soft = await mark();
      const one = await freshSpace();
      const two = await freshSpace();
      const rows = await eventually(
        () => since(soft),
        (found) => found.some((row) => row.type === 'limit.exceeded'),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const exceeded = (await since(soft)).filter((row) => row.type === 'limit.exceeded');
      expect(exceeded.map(shape)).toEqual([
        {
          type: 'limit.exceeded',
          scope: 'instance',
          payload: { limit: 'spaces', used: used + 1, max: used, spaceId: null },
        },
      ]);
      expect(rows.length).toBeGreaterThan(0);
      await ctx.spaces.delete(one.id);
      await ctx.spaces.delete(two.id);
    } finally {
      await restoreSoft();
    }
  });
});

describe('usage transitions', () => {
  it('emits usage.threshold once per threshold and period, and limit.exceeded going over', async () => {
    const space = await freshSpace();
    const scope = { kind: 'space' as const, id: space.id };
    const handler = usageTransitionEvents(ctx.controlStore.events as ControlEvents);
    const base = { scope, metric: 'apiRequests' as const, max: 100, period: '2026-09' };
    const start = await mark();

    await handler({ ...base, from: 'ok', to: 'warn', threshold: 80, used: 85 });
    await handler({ ...base, from: 'warn', to: 'over', threshold: 100, used: 120 });
    // Down again (a raised limit) and up: nothing repeats.
    await handler({ ...base, from: 'over', to: 'warn', threshold: 80, used: 120 });
    await handler({ ...base, from: 'warn', to: 'over', threshold: 100, used: 130 });
    await handler({ ...base, period: '2026-10', from: 'ok', to: 'warn', threshold: 80, used: 90 });

    const common = { metric: 'apiRequests', max: 100 };
    expect((await since(start)).map((row) => [row.type, row.payload])).toEqual([
      ['usage.threshold', { ...common, used: 85, period: '2026-09', threshold: 80, level: 'warn' }],
      [
        'usage.threshold',
        { ...common, used: 120, period: '2026-09', threshold: 100, level: 'over' },
      ],
      ['limit.exceeded', { ...common, used: 120, period: '2026-09' }],
      ['limit.exceeded', { ...common, used: 130, period: '2026-09' }],
      ['usage.threshold', { ...common, used: 90, period: '2026-10', threshold: 80, level: 'warn' }],
    ]);
  });
});

describe('the outbox', () => {
  it('logs and goes on when a write outside a transaction fails', async () => {
    const warnings: unknown[] = [];
    const events = new ControlEvents(
      { logger: { warn: (...args: unknown[]) => warnings.push(args) } } as never,
      {
        controlEvents: {
          append: async () => {
            throw new Error('outbox away');
          },
        },
      } as unknown as Repositories,
    );
    await expect(events.emit('user.created', { kind: 'instance' })).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('fails the cause when the write inside its transaction fails', async () => {
    const start = await mark();
    const machineName = name();
    await expect(
      ctx.repos.transaction(async (tx) => {
        await tx.spaces.create({ name: 'Tx', machineName, url: 'http://ev.test' });
        await ctx.controlStore.events?.emit(
          'space.created',
          { kind: 'space', id: 'not-a-uuid' },
          {},
          { tx: { controlEvents: { append: () => Promise.reject(new Error('no outbox')) } } },
        );
      }),
    ).rejects.toThrow('no outbox');
    expect((await ctx.repos.spaces.list()).some((row) => row.machineName === machineName)).toBe(
      false,
    );
    expect(await since(start)).toEqual([]);
  });

  it('pages in seq order', async () => {
    const start = await mark();
    await ctx.repos.controlEvents.appendMany(
      Array.from({ length: 5 }, (_, index) => ({
        type: 'user.created',
        scope: { kind: 'instance' as const },
        payload: { index },
      })),
    );
    const first = await ctx.repos.controlEvents.listAfter(start, 2);
    const second = await ctx.repos.controlEvents.listAfter(first.at(-1)?.seq ?? 0, 10);
    expect([...first, ...second].map((row) => row.payload.index)).toEqual([0, 1, 2, 3, 4]);
    expect(first.map((row) => row.seq)).toEqual([start + 1, start + 2]);
  });

  it('prunes events past the retention window, delivered or not', async () => {
    await ctx.repos.controlEvents.append({ type: 'user.created', scope: { kind: 'instance' } });
    const latest = await mark();
    const soon = new Date(Date.now() + 29 * 24 * 60 * 60_000);
    expect(await pruneControlEvents(ctx.manablox, ctx.repos, soon)).toBe(0);

    const restore = await withControls(ctx, { values: { 'retention.controlEventsDays': 60 } });
    try {
      const later = new Date(Date.now() + 59 * 24 * 60 * 60_000);
      expect(await pruneControlEvents(ctx.manablox, ctx.repos, later)).toBe(0);
    } finally {
      await restore();
    }

    const late = new Date(Date.now() + 31 * 24 * 60 * 60_000);
    expect(await pruneControlEvents(ctx.manablox, ctx.repos, late)).toBeGreaterThan(0);
    // The latest stays, so seq never goes back.
    expect((await ctx.repos.controlEvents.listAfter(0, 1000)).map((row) => row.seq)).toEqual([
      latest,
    ]);
  });
});

interface Received {
  body: string;
  signature: string;
  events: Array<{ seq: number; type: string; payload: Record<string, unknown> }>;
}

describe('push', () => {
  const secret = 'push-secret';
  let server: Server;
  let url: string;
  const received: Received[] = [];
  let respond: (events: Received['events']) => number = () => 204;

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        const events = (JSON.parse(body) as { events: Received['events'] }).events;
        received.push({
          body,
          signature: String(request.headers[CONTROL_SIGNATURE_HEADER]),
          events,
        });
        response.statusCode = respond(events);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  /** Marks everything earlier delivered, so each test pushes only its own events. */
  const fresh = async () => {
    for (;;) {
      const rows = await ctx.repos.controlEvents.listUndelivered(1000);
      if (rows.length === 0) break;
      await ctx.repos.controlEvents.markDelivered(rows.map((row) => row.id));
    }
    received.length = 0;
    respond = () => 204;
  };

  const append = (markers: string[]) =>
    ctx.repos.controlEvents.appendMany(
      markers.map((marker) => ({
        type: 'user.created',
        scope: { kind: 'instance' as const },
        payload: { marker },
      })),
    );

  const delivery = (options: Record<string, unknown> = {}) =>
    new ControlEventDelivery(ctx.manablox, ctx.repos, {
      url,
      secret,
      fetch: globalThis.fetch,
      backoffMs: 20,
      ...options,
    });

  it('posts signed batches in seq order and marks them delivered', async () => {
    await fresh();
    const rows = await append(['a', 'b', 'c']);
    const push = delivery({ batchSize: 2 });
    expect(await push.run()).toEqual({ delivered: 3, failed: false });
    await push.close();

    expect(received.map((hit) => hit.events.map((event) => event.payload.marker))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    for (const hit of received) {
      const [t, v1] = hit.signature.split(',').map((part) => part.split('=')[1]);
      const expected = createHmac('sha256', secret).update(`${t}.${hit.body}`).digest('hex');
      expect(v1).toBe(expected);
      expect(signControlEvents(secret, hit.body, Number(t))).toBe(hit.signature);
      expect(Math.abs(Date.now() / 1000 - Number(t))).toBeLessThan(60);
    }
    const stored = await ctx.repos.controlEvents.listAfter((rows[0]?.seq ?? 1) - 1, 3);
    expect(stored.every((row) => row.deliveredAt !== null)).toBe(true);
  });

  it('backs off after a failure and retries on its own', async () => {
    await fresh();
    await append(['x']);
    let calls = 0;
    respond = () => (++calls === 1 ? 503 : 204);
    const push = delivery({ backoffMs: 100 });
    expect(await push.run()).toEqual({ delivered: 0, failed: true });
    // Within the backoff nothing is sent.
    expect(await push.run()).toEqual({ delivered: 0, failed: false });
    expect(calls).toBe(1);
    const [row] = await ctx.repos.controlEvents.listUndelivered(10);
    expect(row?.attempts).toBe(1);

    await eventually(
      async () => ctx.repos.controlEvents.listUndelivered(10),
      (rows) => rows.length === 0,
    );
    expect(calls).toBe(2);
    await push.close();
  });

  it('sends a failed event alone and leaves it for pull once its attempts are used', async () => {
    await fresh();
    await append(['a', 'poison', 'b']);
    respond = (events) => (events.some((event) => event.payload.marker === 'poison') ? 400 : 200);
    const push = delivery({ maxAttempts: 2, backoffMs: 1 });

    const runs: Array<{ delivered: number; failed: boolean }> = [];
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      runs.push(await push.run());
      if ((await ctx.repos.controlEvents.listUndelivered(10, 2)).length === 0) break;
    }
    await push.close();

    expect(received.map((hit) => hit.events.map((event) => event.payload.marker))).toEqual([
      ['a', 'poison', 'b'],
      ['a'],
      ['poison'],
      ['b'],
    ]);
    const left = await ctx.repos.controlEvents.listUndelivered(10);
    expect(left.map((row) => [row.payload.marker, row.attempts])).toEqual([['poison', 2]]);
  });

  it('coalesces triggers into one run', async () => {
    await fresh();
    await append(['t1', 't2']);
    const push = delivery({ debounceMs: 10 });
    push.trigger();
    push.trigger();
    await eventually(
      async () => received.length,
      (count) => count > 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await push.close();
    expect(received).toHaveLength(1);
    expect(received[0]?.events.map((event) => event.payload.marker)).toEqual(['t1', 't2']);
  });
});

const redisUrl = process.env.TEST_REDIS_URL ?? '';

describe.skipIf(!redisUrl)('sampling over Redis', () => {
  it('lets one process of several emit per window', async () => {
    const prefix = `test:controlEvents:${randomUUID()}:`;
    const clients = [createRedis(redisUrl, 'command'), createRedis(redisUrl, 'command')];
    const [a, b] = clients.map(
      (redis) => new ControlEvents(ctx.manablox, ctx.repos, { redis, prefix }),
    ) as [ControlEvents, ControlEvents];
    const space = await freshSpace();
    const scope = { kind: 'space' as const, id: space.id };
    const start = await mark();
    try {
      await a.sample('feature.denied', scope, 'tags', { feature: 'tags' });
      await b.sample('feature.denied', scope, 'tags', { feature: 'tags' });
      await b.sample('feature.denied', scope, 'menus', { feature: 'menus' });
      expect((await since(start)).map((row) => row.payload.feature)).toEqual(['tags', 'menus']);
      const ttl = await clients[0]?.ttl(`${prefix}feature.denied:space:${space.id}:tags`);
      expect(ttl).toBeGreaterThan(3500);
    } finally {
      const keys = (await clients[0]?.keys(`${prefix}*`)) ?? [];
      if (keys.length > 0) await clients[0]?.del(...keys);
      await a.close();
      await b.close();
    }
  });
});
