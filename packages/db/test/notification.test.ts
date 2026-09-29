import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationInsert } from '../src/repositories/notification.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;
let otherSpaceId: string;

beforeAll(async () => {
  ctx = await createRepositoryContext('notification');
  otherSpaceId = (
    await ctx.repos.spaces.create({ name: 'Other', machineName: 'other', url: 'http://o.test' })
  ).id;
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const user = async () => {
  const n = ++counter;
  return ctx.repos.users.create({
    name: `User ${n}`,
    email: `user-${n}-${Date.now().toString(36)}@example.com`,
    role: 'editor',
    passwordHash: 'x',
  });
};

const notify = (userId: string, rows: Partial<NotificationInsert>[]) =>
  ctx.repos.notifications.createMany(
    rows.map((row, index) => ({
      userId,
      spaceId: ctx.spaceId,
      kind: 'content.approved',
      title: `Note ${index}`,
      ...row,
    })),
  );

describe('notifications.createMany', () => {
  it('inserts one row per recipient with defaults for the optional columns', async () => {
    const [a, b] = await Promise.all([user(), user()]);
    const rows = await ctx.repos.notifications.createMany([
      { userId: a.id, kind: 'member.granted', title: 'Welcome' },
      {
        userId: b.id,
        spaceId: ctx.spaceId,
        kind: 'content.approvalRequested',
        title: 'Review',
        body: 'Please look',
        url: '/content/1',
        targetKind: 'content',
        targetId: '1',
        actorLabel: 'Sam',
        meta: { version: 3 },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.userId === a.id)).toMatchObject({
      spaceId: null,
      body: '',
      url: null,
      meta: null,
      readAt: null,
    });
    expect(rows.find((row) => row.userId === b.id)).toMatchObject({
      body: 'Please look',
      meta: { version: 3 },
      targetKind: 'content',
    });
    expect(await ctx.repos.notifications.createMany([])).toEqual([]);
  });
});

describe('notifications.pageByUser', () => {
  it('pages one user inbox newest first with a total', async () => {
    const [me, someoneElse] = await Promise.all([user(), user()]);
    for (let index = 0; index < 5; index++) {
      await notify(me.id, [{ title: `n${index}` }]);
      // SQLite stamps in milliseconds; keep the creation times apart.
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    await notify(someoneElse.id, [{ title: 'not mine' }]);

    const first = await ctx.repos.notifications.pageByUser(me.id, {}, { limit: 2, offset: 0 });
    expect(first.total).toBe(5);
    expect(first.items.map((row) => row.title)).toEqual(['n4', 'n3']);
    const last = await ctx.repos.notifications.pageByUser(me.id, {}, { limit: 2, offset: 4 });
    expect(last.items.map((row) => row.title)).toEqual(['n0']);
    const past = await ctx.repos.notifications.pageByUser(me.id, {}, { limit: 2, offset: 10 });
    expect(past).toMatchObject({ items: [], total: 5 });
  });

  it('filters by unread, kinds and space (null meaning instance-wide)', async () => {
    const me = await user();
    const rows = await notify(me.id, [
      { title: 'approved', kind: 'content.approved' },
      { title: 'rejected', kind: 'content.rejected' },
      { title: 'elsewhere', spaceId: otherSpaceId, kind: 'content.approvalWithdrawn' },
      { title: 'global', spaceId: null, kind: 'member.granted' },
    ]);
    const approved = rows.find((row) => row.title === 'approved');
    await ctx.repos.notifications.markRead(me.id, [approved?.id ?? '']);

    const titles = async (filter: Parameters<typeof ctx.repos.notifications.pageByUser>[1]) =>
      (await ctx.repos.notifications.pageByUser(me.id, filter)).items
        .map((row) => row.title)
        .sort();

    expect(await titles({ unreadOnly: true })).toEqual(['elsewhere', 'global', 'rejected']);
    expect(await titles({ kinds: ['content.approved', 'content.rejected'] })).toEqual([
      'approved',
      'rejected',
    ]);
    expect(await titles({ spaceId: otherSpaceId })).toEqual(['elsewhere']);
    expect(await titles({ spaceId: null })).toEqual(['global']);
    expect(await titles({ kinds: [] })).toHaveLength(4);
  });
});

describe('notifications read state', () => {
  it('counts unread per user and marks read without touching other users', async () => {
    const [me, other] = await Promise.all([user(), user()]);
    const mine = await notify(me.id, [{}, {}, {}]);
    const theirs = await notify(other.id, [{}]);
    expect(await ctx.repos.notifications.countUnread(me.id)).toBe(3);

    // Another user's id is ignored.
    const changed = await ctx.repos.notifications.markRead(me.id, [
      mine[0]?.id ?? '',
      theirs[0]?.id ?? '',
    ]);
    expect(changed).toBe(1);
    expect(await ctx.repos.notifications.countUnread(me.id)).toBe(2);
    expect(await ctx.repos.notifications.countUnread(other.id)).toBe(1);
    expect(await ctx.repos.notifications.markRead(me.id, [])).toBe(0);
  });

  it('keeps the first read time when marked read twice', async () => {
    const me = await user();
    const [row] = await notify(me.id, [{}]);
    const id = row?.id ?? '';
    await ctx.repos.notifications.markRead(me.id, [id]);
    const firstRead = (await ctx.repos.notifications.findById(id, me.id))?.readAt;
    expect(firstRead).toBeInstanceOf(Date);
    expect(await ctx.repos.notifications.markRead(me.id, [id])).toBe(0);
    expect((await ctx.repos.notifications.findById(id, me.id))?.readAt).toEqual(firstRead);
  });

  it('markUnread and markAllRead report the rows they changed', async () => {
    const me = await user();
    const rows = await notify(me.id, [{}, {}]);
    const ids = rows.map((row) => row.id);
    expect(await ctx.repos.notifications.markAllRead(me.id)).toBe(2);
    expect(await ctx.repos.notifications.markAllRead(me.id)).toBe(0);
    expect(await ctx.repos.notifications.markUnread(me.id, ids.slice(0, 1))).toBe(1);
    expect(await ctx.repos.notifications.countUnread(me.id)).toBe(1);
    expect(await ctx.repos.notifications.markUnread(me.id, [])).toBe(0);
  });
});

describe('notifications lookups and deletes', () => {
  it('findById is scoped to the owner', async () => {
    const [me, other] = await Promise.all([user(), user()]);
    const [row] = await notify(me.id, [{}]);
    expect((await ctx.repos.notifications.findById(row?.id ?? '', me.id))?.id).toBe(row?.id);
    expect(await ctx.repos.notifications.findById(row?.id ?? '', other.id)).toBeNull();
  });

  it('delete answers whether rows went and never deletes another user rows', async () => {
    const [me, other] = await Promise.all([user(), user()]);
    const [mine] = await notify(me.id, [{}]);
    const [theirs] = await notify(other.id, [{}]);
    expect(await ctx.repos.notifications.delete(me.id, [theirs?.id ?? ''])).toBe(false);
    expect(await ctx.repos.notifications.delete(me.id, [])).toBe(false);
    expect(await ctx.repos.notifications.delete(me.id, [mine?.id ?? ''])).toBe(true);
    expect(await ctx.repos.notifications.delete(me.id, [mine?.id ?? ''])).toBe(false);
    expect(await ctx.repos.notifications.findById(theirs?.id ?? '', other.id)).not.toBeNull();
  });

  it('deleteRead removes only read rows of that user', async () => {
    const [me, other] = await Promise.all([user(), user()]);
    const mine = await notify(me.id, [{ title: 'read' }, { title: 'unread' }]);
    const [theirs] = await notify(other.id, [{}]);
    await ctx.repos.notifications.markRead(me.id, [mine[0]?.id ?? '']);
    await ctx.repos.notifications.markAllRead(other.id);

    expect(await ctx.repos.notifications.deleteRead(me.id)).toBe(true);
    expect(await ctx.repos.notifications.deleteRead(me.id)).toBe(false);
    const left = await ctx.repos.notifications.pageByUser(me.id);
    expect(left.items.map((row) => row.title)).toEqual(['unread']);
    expect(await ctx.repos.notifications.findById(theirs?.id ?? '', other.id)).not.toBeNull();
  });
});
