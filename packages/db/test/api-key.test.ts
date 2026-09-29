import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('api_key');
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const user = () => {
  const n = ++counter;
  return ctx.repos.users.create({
    name: `Owner ${n}`,
    email: `owner-${n}-${Date.now().toString(36)}@example.com`,
    role: 'editor',
    passwordHash: 'x',
  });
};

const key = async (
  userId: string,
  data: Partial<Parameters<typeof ctx.repos.apiKeys.create>[0]> = {},
) => {
  const n = ++counter;
  const row = await ctx.repos.apiKeys.create({
    userId,
    name: `key ${n}`,
    prefix: `mb_${n}_`,
    start: `mb_${n}`,
    key: `digest-${n}`,
    ...data,
  });
  if (!row) throw new Error('key not created');
  return row;
};

describe('apiKeys', () => {
  it('creates a key with defaults and lists a user keys without the digest', async () => {
    const [owner, other] = await Promise.all([user(), user()]);
    const created = await key(owner.id, { spaceIds: [ctx.spaceId], permissions: ['content:read'] });
    await key(other.id);
    expect(created).toMatchObject({ enabled: true, expiresAt: null, lastRequest: null });

    const listed = await ctx.repos.apiKeys.listByUser(owner.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      spaceIds: [ctx.spaceId],
      permissions: ['content:read'],
    });
    expect(listed[0]).not.toHaveProperty('key');
    expect(listed[0]).not.toHaveProperty('prefix');
  });

  it('finds an enabled key by prefix and ignores disabled or unknown prefixes', async () => {
    const owner = await user();
    const enabled = await key(owner.id, { prefix: 'mb_live_' });
    await key(owner.id, { prefix: 'mb_off_', enabled: false });
    expect((await ctx.repos.apiKeys.findEnabledByPrefix('mb_live_'))?.id).toBe(enabled.id);
    expect(await ctx.repos.apiKeys.findEnabledByPrefix('mb_off_')).toBeNull();
    expect(await ctx.repos.apiKeys.findEnabledByPrefix('mb_none_')).toBeNull();
  });

  it('touch records the last request time', async () => {
    const owner = await user();
    const row = await key(owner.id);
    const at = new Date('2026-01-02T03:04:05.000Z');
    await ctx.repos.apiKeys.touch(row.id, at);
    const [listed] = await ctx.repos.apiKeys.listByUser(owner.id);
    expect(listed?.lastRequest?.toISOString()).toBe(at.toISOString());
  });

  it('deleteReturning returns the removed key once, then null', async () => {
    const owner = await user();
    const row = await key(owner.id, { name: 'doomed' });
    expect(await ctx.repos.apiKeys.deleteReturning(row.id)).toEqual({
      id: row.id,
      name: 'doomed',
      userId: owner.id,
    });
    expect(await ctx.repos.apiKeys.deleteReturning(row.id)).toBeNull();
    expect(await ctx.repos.apiKeys.listByUser(owner.id)).toEqual([]);
  });

  it('deleteExpiredReturning removes only keys past their expiry', async () => {
    const owner = await user();
    const hour = 60 * 60 * 1000;
    const expired = await key(owner.id, {
      name: 'expired',
      expiresAt: new Date(Date.now() - hour),
    });
    const future = await key(owner.id, { expiresAt: new Date(Date.now() + hour) });
    const forever = await key(owner.id, { expiresAt: null });

    const removed = await ctx.repos.apiKeys.deleteExpiredReturning();
    expect(removed).toContainEqual({ id: expired.id, name: 'expired' });
    const left = (await ctx.repos.apiKeys.listByUser(owner.id)).map((row) => row.id).sort();
    expect(left).toEqual([future.id, forever.id].sort());
    expect(await ctx.repos.apiKeys.deleteExpiredReturning()).toEqual([]);
  });

  it('drops a user keys with the user', async () => {
    const owner = await user();
    await key(owner.id, { prefix: 'mb_cascade_' });
    expect(await ctx.repos.users.delete(owner.id)).toBe(true);
    expect(await ctx.repos.apiKeys.findEnabledByPrefix('mb_cascade_')).toBeNull();
  });
});
