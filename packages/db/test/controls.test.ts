import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('controls');
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const freshSpace = async () => {
  const name = `controls-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;
};

const instance = { kind: 'instance' } as const;
const space = (id: string) => ({ kind: 'space', id }) as const;
const group = (id: string) => ({ kind: 'group', id }) as const;

describe('control settings', () => {
  it('keeps one value per scope and key, the instance included', async () => {
    const { controlSettings } = ctx.repos;
    await controlSettings.upsert(instance, 'features.databags', { enabled: true }, 'control');
    const row = await controlSettings.upsert(instance, 'features.databags', { enabled: false });
    expect(row).toMatchObject({ scopeKind: 'instance', scopeId: '', value: { enabled: false } });
    expect(row.updatedBy).toBeNull();
    expect(await controlSettings.listByScope(instance)).toHaveLength(1);
    expect((await controlSettings.find(instance, 'features.databags'))?.value).toEqual({
      enabled: false,
    });

    const error = await ctx.handle.db
      .insert(ctx.handle.tables.controlSettings)
      .values({ scopeKind: 'instance', key: 'features.databags', value: 1 })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, 'control_settings')).toBe(true);
    await controlSettings.deleteScope(instance);
  });

  it('reads several scopes at once and replaces a scope atomically', async () => {
    const { controlSettings } = ctx.repos;
    const spaceId = await freshSpace();
    const { id: groupId } = await ctx.repos.spaceGroups.create({ name: 'g' });
    await controlSettings.upsert(instance, 'limits.spaces', { max: 5 });
    await controlSettings.upsertMany(group(groupId), { a: 1, b: 2 });
    await controlSettings.upsertMany(space(spaceId), { a: 3, c: [1] });
    await controlSettings.upsert(space(await freshSpace()), 'a', 9);

    const rows = await controlSettings.listByScopes([instance, group(groupId), space(spaceId)]);
    expect(rows.map((row) => [row.scopeKind, row.key, row.value])).toEqual([
      ['group', 'a', 1],
      ['group', 'b', 2],
      ['instance', 'limits.spaces', { max: 5 }],
      ['space', 'a', 3],
      ['space', 'c', [1]],
    ]);

    const replaced = await controlSettings.replaceScope(
      group(groupId),
      { b: 20, d: { max: null } },
      'control',
    );
    expect(replaced.map((row) => [row.key, row.value])).toEqual([
      ['b', 20],
      ['d', { max: null }],
    ]);
    expect((await controlSettings.listByScope(group(groupId))).map((row) => row.key)).toEqual([
      'b',
      'd',
    ]);
    await controlSettings.replaceScope(group(groupId), {});
    expect(await controlSettings.listByScope(group(groupId))).toEqual([]);

    expect(await controlSettings.delete(space(spaceId), 'a')).toBe(true);
    expect(await controlSettings.delete(space(spaceId), 'a')).toBe(false);
    expect(await controlSettings.deleteScope(space(spaceId))).toBe(true);
    expect(await controlSettings.listByScope(space(spaceId))).toEqual([]);
    await controlSettings.deleteScope(instance);
  });

  it('rolls back a failed replace', async () => {
    const { controlSettings } = ctx.repos;
    const scope = space(await freshSpace());
    await controlSettings.upsertMany(scope, { keep: 1 });
    await expect(
      ctx.repos.transaction(async (tx) => {
        await tx.controlSettings.replaceScope(scope, { other: 2 });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await controlSettings.listByScope(scope)).map((row) => row.key)).toEqual(['keep']);
  });

  it('refuses a group or space scope without an id', async () => {
    await expect(ctx.repos.controlSettings.listByScope({ kind: 'space' })).rejects.toThrow();
  });
});

describe('space groups', () => {
  it('creates, finds, updates and deletes groups', async () => {
    const { spaceGroups } = ctx.repos;
    const created = await spaceGroups.create({ name: 'Agency', externalId: 'ext-1' });
    expect(created).toMatchObject({ name: 'Agency', externalId: 'ext-1' });
    expect((await spaceGroups.findByExternalId('ext-1'))?.id).toBe(created.id);
    expect((await spaceGroups.findById(created.id))?.name).toBe('Agency');

    const error = await spaceGroups
      .create({ name: 'Other', externalId: 'ext-1' })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, 'space_groups')).toBe(true);
    // Groups without an external id may be many.
    await spaceGroups.create({ name: 'n1' });
    await spaceGroups.create({ name: 'n2' });

    const updated = await spaceGroups.update(created.id, { name: 'Agency 2' });
    expect(updated).toMatchObject({ name: 'Agency 2', externalId: 'ext-1' });
    expect(await spaceGroups.update(crypto.randomUUID(), { name: 'x' })).toBeNull();
    expect((await spaceGroups.list()).map((row) => row.name)).toContain('Agency 2');

    expect(await spaceGroups.delete(created.id)).toBe(true);
    expect(await spaceGroups.findById(created.id)).toBeNull();
  });

  it('assigns spaces, one group per space, and clears them when the group goes', async () => {
    const { spaceGroups } = ctx.repos;
    const a = await spaceGroups.create({ name: 'A' });
    const b = await spaceGroups.create({ name: 'B' });
    const [s1, s2, s3] = [await freshSpace(), await freshSpace(), await freshSpace()];

    expect((await spaceGroups.assignSpaces(a.id, [s1, s2, s2])).sort()).toEqual([s1, s2].sort());
    expect((await spaceGroups.findBySpace(s1))?.id).toBe(a.id);
    expect(await spaceGroups.findBySpace(s3)).toBeNull();

    // Moving a space takes it out of its old group.
    expect(await spaceGroups.assignSpaces(b.id, [s2])).toEqual([s2]);
    expect(await spaceGroups.listSpaceIds(a.id)).toEqual([s1]);

    // Replacing drops the spaces left out; unchanged ones are not reported.
    const changed = await spaceGroups.assignSpaces(a.id, [s3], { replace: true });
    expect(changed.sort()).toEqual([s1, s3].sort());
    expect((await spaceGroups.listSpaces(a.id)).map((row) => row.id)).toEqual([s3]);
    expect((await ctx.repos.spaces.findById(s1))?.groupId).toBeNull();
    expect(await spaceGroups.assignSpaces(a.id, [s3])).toEqual([]);

    await spaceGroups.unassignSpaces([s2]);
    expect(await spaceGroups.findBySpace(s2)).toBeNull();

    await spaceGroups.delete(a.id);
    expect((await ctx.repos.spaces.findById(s3))?.groupId).toBeNull();
  });
});

describe('usage counters', () => {
  it('adds deltas, merging repeated keys, and sets values', async () => {
    const { usageCounters } = ctx.repos;
    const spaceId = await freshSpace();
    const key = { scope: space(spaceId), metric: 'apiRequests', period: '2026-10' };
    await usageCounters.incrementMany([
      { ...key, delta: 2 },
      { ...key, delta: 3 },
      { ...key, metric: 'mails', delta: 1 },
      { ...key, metric: 'uploads', delta: 0 },
    ]);
    await usageCounters.increment(key, 5);
    expect(await usageCounters.get(key)).toBe(10);
    expect(await usageCounters.get({ ...key, metric: 'uploads' })).toBe(0);

    // Beyond 32 bits.
    await usageCounters.set({ ...key, metric: 'bandwidthBytes' }, 2 ** 40);
    await usageCounters.increment({ ...key, metric: 'bandwidthBytes' }, 1);
    expect(await usageCounters.get({ ...key, metric: 'bandwidthBytes' })).toBe(2 ** 40 + 1);

    expect(
      (await usageCounters.listForScope(space(spaceId), '2026-10')).map((row) => [
        row.metric,
        row.value,
      ]),
    ).toEqual([
      ['apiRequests', 10],
      ['bandwidthBytes', 2 ** 40 + 1],
      ['mails', 1],
    ]);

    await usageCounters.set({ scope: instance, metric: 'x', period: 'total' }, 7);
    expect(await usageCounters.get({ scope: instance, metric: 'x', period: 'total' })).toBe(7);
  });

  it('sums space counters over a list of spaces or all of them', async () => {
    const { usageCounters } = ctx.repos;
    const period = 'sum-test';
    const [s1, s2, s3] = [await freshSpace(), await freshSpace(), await freshSpace()];
    await usageCounters.incrementMany([
      { scope: space(s1), metric: 'documents', period, delta: 4 },
      { scope: space(s2), metric: 'documents', period, delta: 6 },
      { scope: space(s3), metric: 'documents', period, delta: 10 },
      { scope: space(s1), metric: 'storageBytes', period, delta: 100 },
      // Not a space row, so not summed.
      { scope: instance, metric: 'documents', period, delta: 1000 },
    ]);
    expect(await usageCounters.sumForSpaces('documents', period, [s1, s2])).toBe(10);
    expect(await usageCounters.sumForSpaces('documents', period, 'all')).toBe(20);
    expect(await usageCounters.sumForSpaces('documents', period, [])).toBe(0);
    expect(await usageCounters.sumForSpaces('missing', period, 'all')).toBe(0);
    expect(await usageCounters.sumsForSpaces(period, [s1, s3])).toEqual({
      documents: 14,
      storageBytes: 100,
    });

    expect(await usageCounters.deleteScope(space(s3))).toBe(true);
    expect(await usageCounters.sumForSpaces('documents', period, 'all')).toBe(10);
  });

  it('adds a flushed batch once until its id is pruned', async () => {
    const key = { scope: instance, metric: 'flushed', period: 'once-test' };
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    const once = (at?: Date) =>
      ctx.repos.transaction((tx) =>
        tx.usageCounters.incrementOnce('batch-1', [{ ...key, delta: 3 }], at),
      );
    expect(await once(old)).toBe(true);
    expect(await once()).toBe(false);
    expect(await ctx.repos.usageCounters.get(key)).toBe(3);

    await ctx.repos.usageCounters.pruneFlushes(new Date(Date.now() - 7 * 24 * 60 * 60_000));
    expect(await once()).toBe(true);
    expect(await ctx.repos.usageCounters.get(key)).toBe(6);
  });
});

describe('external usage', () => {
  it('stores each idempotency key once', async () => {
    const spaceId = await freshSpace();
    const input = {
      idempotencyKey: `k-${crypto.randomUUID()}`,
      spaceId,
      metric: 'bandwidthBytes',
      period: '2026-10',
      value: 5,
      mode: 'add',
    } as const;
    expect(await ctx.repos.usageExternal.insert(input)).toBe(true);
    expect(await ctx.repos.usageExternal.insert({ ...input, value: 99 })).toBe(false);
    expect((await ctx.repos.usageExternal.findByKey(input.idempotencyKey))?.value).toBe(5);
  });

  it('totals the latest set plus the adds after it', async () => {
    const { usageExternal } = ctx.repos;
    const [s1, s2] = [await freshSpace(), await freshSpace()];
    const report = async (
      spaceId: string,
      mode: 'add' | 'set',
      value: number,
      metric = 'bandwidthBytes',
      period = '2026-10',
    ) =>
      usageExternal.insert({
        idempotencyKey: crypto.randomUUID(),
        spaceId,
        metric,
        period,
        value,
        mode,
      });

    expect(await usageExternal.total(s1, 'bandwidthBytes', '2026-10')).toBe(0);
    await report(s1, 'add', 10);
    await report(s1, 'add', 5);
    expect(await usageExternal.total(s1, 'bandwidthBytes', '2026-10')).toBe(15);
    await report(s1, 'set', 100);
    expect(await usageExternal.total(s1, 'bandwidthBytes', '2026-10')).toBe(100);
    await report(s1, 'add', 7);
    await report(s1, 'add', 2 ** 40);
    expect(await usageExternal.total(s1, 'bandwidthBytes', '2026-10')).toBe(107 + 2 ** 40);
    await report(s1, 'set', 3);
    expect(await usageExternal.total(s1, 'bandwidthBytes', '2026-10')).toBe(3);

    await report(s2, 'set', 50);
    await report(s2, 'add', 1, 'apiRequests');
    await report(s2, 'add', 1000, 'bandwidthBytes', '2026-11');

    expect(await usageExternal.totals({ period: '2026-10', spaceIds: [s1, s2] })).toEqual(
      [
        { spaceId: s1, metric: 'bandwidthBytes', period: '2026-10', value: 3 },
        { spaceId: s2, metric: 'apiRequests', period: '2026-10', value: 1 },
        { spaceId: s2, metric: 'bandwidthBytes', period: '2026-10', value: 50 },
      ].sort((a, b) => a.spaceId.localeCompare(b.spaceId) || a.metric.localeCompare(b.metric)),
    );
    expect(
      await usageExternal.totals({ period: '2026-10', metric: 'bandwidthBytes', spaceIds: [s2] }),
    ).toEqual([{ spaceId: s2, metric: 'bandwidthBytes', period: '2026-10', value: 50 }]);
    const all = await usageExternal.totals({ period: '2026-11' });
    expect(all.find((row) => row.spaceId === s2)?.value).toBe(1000);
  });

  it('goes with its space', async () => {
    const spaceId = await freshSpace();
    const idempotencyKey = crypto.randomUUID();
    await ctx.repos.usageExternal.insert({
      idempotencyKey,
      spaceId,
      metric: 'apiRequests',
      period: '2026-10',
      value: 1,
      mode: 'add',
    });
    await ctx.repos.spaces.delete(spaceId);
    expect(await ctx.repos.usageExternal.findByKey(idempotencyKey)).toBeNull();
  });
});

describe('control events', () => {
  it('appends in order and lists after a seq', async () => {
    const { controlEvents } = ctx.repos;
    const start = await controlEvents.latestSeq();
    const first = await controlEvents.append({
      type: 'space.created',
      scope: space(crypto.randomUUID()),
      payload: { name: 'x' },
    });
    const many = await controlEvents.appendMany([
      { type: 'limit.exceeded', scope: instance },
      { type: 'limit.blocked', scope: instance, payload: { limit: 'spaces' } },
    ]);
    expect(first.seq).toBeGreaterThan(start);
    expect(many.map((row) => row.seq)).toEqual([first.seq + 1, first.seq + 2]);
    expect(many[0]).toMatchObject({ scopeKind: 'instance', scopeId: '', payload: {}, attempts: 0 });
    expect(await controlEvents.latestSeq()).toBe(first.seq + 2);

    const after = await controlEvents.listAfter(start, 10);
    expect(after.map((row) => row.type)).toEqual([
      'space.created',
      'limit.exceeded',
      'limit.blocked',
    ]);
    expect((await controlEvents.listAfter(first.seq, 1)).map((row) => row.seq)).toEqual([
      first.seq + 1,
    ]);
  });

  it('is written with the transaction of its cause', async () => {
    const { controlEvents } = ctx.repos;
    const start = await controlEvents.latestSeq();
    await expect(
      ctx.repos.transaction(async (tx) => {
        await tx.controlEvents.append({ type: 'rolled.back', scope: instance });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await controlEvents.listAfter(start, 10)).toEqual([]);

    const row = await ctx.repos.transaction(async (tx) => {
      const spaceId = (await tx.spaces.create({ name: 'ev', machineName: 'ev', url: 'http://t' }))
        .id;
      return tx.controlEvents.append({ type: 'space.created', scope: space(spaceId) });
    });
    expect((await controlEvents.listAfter(start, 10)).map((r) => r.id)).toEqual([row.id]);
  });

  it('tracks delivery and prunes old events', async () => {
    const { controlEvents } = ctx.repos;
    const rows = await controlEvents.appendMany([
      { type: 'd1', scope: instance },
      { type: 'd2', scope: instance },
      { type: 'd3', scope: instance },
    ]);
    const [d1, d2, d3] = rows.map((row) => row.id) as [string, string, string];
    await controlEvents.incrementAttempts([d1, d2]);
    await controlEvents.incrementAttempts([d2]);
    await controlEvents.markDelivered([d1]);

    const pending = (await controlEvents.listUndelivered(100)).map((row) => row.id);
    expect(pending).toContain(d2);
    expect(pending).toContain(d3);
    expect(pending).not.toContain(d1);
    const retryable = (await controlEvents.listUndelivered(100, 2)).map((row) => row.id);
    expect(retryable).not.toContain(d2);
    expect(retryable).toContain(d3);
    const [after] = await controlEvents.listAfter(rows[1]!.seq - 1, 1);
    expect(after?.attempts).toBe(2);

    const future = new Date(Date.now() + 60_000);
    expect(await controlEvents.pruneBefore(future, { deliveredOnly: true })).toBeGreaterThan(0);
    expect((await controlEvents.listAfter(0, 1000)).map((row) => row.id)).not.toContain(d1);
    await controlEvents.pruneBefore(future);
    // The latest stays, so numbering continues after it.
    expect((await controlEvents.listAfter(0, 1000)).map((row) => row.id)).toEqual([d3]);
    const next = await controlEvents.append({ type: 'd4', scope: instance });
    expect(next.seq).toBe(rows[2]!.seq + 1);
  });
});

describe('instance meta', () => {
  it('stores one value per key and replaces it', async () => {
    const { instanceMeta } = ctx.repos;
    expect(await instanceMeta.get('meta-test')).toBeNull();
    await instanceMeta.set('meta-test', { at: 'first' });
    await instanceMeta.set('meta-test', { at: 'second' });
    expect(await instanceMeta.get('meta-test')).toEqual({ at: 'second' });
  });

  it('keeps the first of racing writes that store a value only once', async () => {
    const { instanceMeta } = ctx.repos;
    const held = await Promise.all(
      ['a', 'b', 'c', 'd'].map((value) => instanceMeta.setIfAbsent('meta-once', value)),
    );
    expect(new Set(held).size).toBe(1);
    expect(await instanceMeta.setIfAbsent('meta-once', 'later')).toBe(held[0]);
    expect(await instanceMeta.get('meta-once')).toBe(held[0]);
  });
});
