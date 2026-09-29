import { type NotificationEvent, usagePeriod } from '@manablox/core';
import { runAsActor } from '@manablox/core/node';
import type { UserRow } from '@manablox/db';
import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext, withControls } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;
const mails: Array<{ to: string[]; subject: string; text: string }> = [];
const pushes: Array<{ endpoint: string; title: string }> = [];
let alice: UserRow;
let bob: UserRow;

beforeAll(async () => {
  ctx = await createServiceContext('notifications', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
    config: { push: { vapidPublicKey: 'test-public-key', vapidPrivateKey: 'test-private-key' } },
    channels: {
      mailer: {
        async send(message) {
          mails.push(message);
          return { id: null };
        },
      },
      pusher: {
        publicKey: 'test-public-key',
        async send(target, payload) {
          pushes.push({ endpoint: target.endpoint, title: payload.title });
          return target.endpoint.endsWith('/gone') ? 'gone' : 'sent';
        },
      },
      adminUrl: 'https://admin.example.com',
    },
  });
  alice = await ctx.repos.users.create({
    name: 'Alice',
    email: 'alice@example.com',
    role: 'editor',
    passwordHash: 'x',
  });
  bob = await ctx.repos.users.create({
    name: 'Bob',
    email: 'bob@example.com',
    role: 'editor',
    passwordHash: 'x',
  });
});
// A delivery still in flight would look up the next test's subscriptions.
afterEach(async () => {
  await ctx.notifications.settle();
});
afterAll(async () => {
  await ctx?.close();
});

describe('notify', () => {
  it('writes one row per recipient, tells the live feed, and leaves the actor out', async () => {
    const heard: NotificationEvent[] = [];
    const stop = ctx.realtime.subscribeNotifications((event) => heard.push(event));

    const result = await runAsActor({ kind: 'user', id: alice.id, label: alice.email }, () =>
      ctx.notifications.notify({
        kind: 'content.approvalRequested',
        recipients: [alice.id, bob.id, bob.id],
        spaceId: ctx.spaceId,
        title: 'Hello',
        body: 'Body',
        url: '/content/x',
      }),
    );
    stop();

    expect(result.inApp.map((row) => row.userId)).toEqual([bob.id]);
    expect(result.inApp[0]?.actorLabel).toBe('alice@example.com');
    expect(heard.map((event) => [event.userId, event.title])).toEqual([[bob.id, 'Hello']]);
    expect(await ctx.notifications.unreadCount(bob.id)).toBe(1);
    expect(await ctx.notifications.unreadCount(alice.id)).toBe(0);
  });

  it('mails and pushes those whose preference asks for it, with a link into the admin', async () => {
    await ctx.repos.pushSubscriptions.upsert({
      userId: bob.id,
      endpoint: 'https://push.example.com/bob',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: null,
    });
    await ctx.repos.pushSubscriptions.upsert({
      userId: bob.id,
      endpoint: 'https://push.example.com/gone',
      keys: { p256dh: 'p', auth: 'a' },
      userAgent: null,
    });
    mails.length = 0;
    pushes.length = 0;

    const result = await ctx.notifications.notify({
      kind: 'content.approved',
      recipients: [bob.id],
      spaceId: ctx.spaceId,
      title: 'Approved',
      body: 'It is live.',
      url: '/content/x',
    });
    await ctx.notifications.settle();

    expect(result.emailed).toEqual([bob.id]);
    expect(result.pushed).toEqual([bob.id]);
    expect(mails).toEqual([
      {
        to: ['bob@example.com'],
        subject: 'Approved',
        text: 'It is live.\n\nhttps://admin.example.com/content/x',
      },
    ]);
    expect(pushes.map((push) => push.endpoint).sort()).toEqual([
      'https://push.example.com/bob',
      'https://push.example.com/gone',
    ]);
    // An expired subscription is deleted.
    const left = await ctx.repos.pushSubscriptions.listByUser(bob.id);
    expect(left.map((row) => row.endpoint)).toEqual(['https://push.example.com/bob']);
  });

  it('reports each sent mail through mail:afterSend', async () => {
    const sent: unknown[] = [];
    const off = ctx.manablox.hooks.on('mail:afterSend', (payload) => {
      sent.push(payload);
    });
    try {
      await ctx.notifications.notify({
        kind: 'content.approved',
        recipients: [bob.id],
        spaceId: ctx.spaceId,
        title: 'Counted',
      });
      await ctx.notifications.settle();
    } finally {
      off();
    }
    expect(sent).toEqual([
      { spaceId: ctx.spaceId, kind: 'notification', recipients: 1, transport: 'instance' },
    ]);
  });

  it('skips the mail while the space has used up its mails; in-app stays', async () => {
    const restore = await withControls(ctx, {
      scope: { kind: 'space', id: ctx.spaceId },
      values: { 'usage.mails': { max: 1, mode: 'hard' } },
    });
    const key = {
      scope: { kind: 'space' as const, id: ctx.spaceId },
      metric: 'mails',
      period: usagePeriod(new Date()).label,
    };
    const before = await ctx.repos.usageCounters.get(key);
    await ctx.repos.usageCounters.set(key, 1);
    await ctx.controlStore.usageState?.evaluate();
    mails.length = 0;
    try {
      const result = await ctx.notifications.notify({
        kind: 'content.approved',
        recipients: [bob.id],
        spaceId: ctx.spaceId,
        title: 'Quiet',
      });
      await ctx.notifications.settle();
      expect(result.inApp.map((row) => row.userId)).toEqual([bob.id]);
      expect(mails).toEqual([]);
    } finally {
      await restore();
      await ctx.repos.usageCounters.set(key, before);
      await ctx.controlStore.usageState?.evaluate();
    }
  });

  it('honours a preference switched off, channel by channel', async () => {
    await ctx.notifications.setPreferences(bob.id, {
      'content.rejected': { inApp: false, email: false, push: true },
    });
    mails.length = 0;
    const before = await ctx.notifications.unreadCount(bob.id);

    const result = await ctx.notifications.notify({
      kind: 'content.rejected',
      recipients: [bob.id],
      title: 'Sent back',
    });
    await ctx.notifications.settle();

    expect(result.inApp).toEqual([]);
    expect(result.emailed).toEqual([]);
    expect(result.pushed).toEqual([bob.id]);
    expect(mails).toEqual([]);
    expect(await ctx.notifications.unreadCount(bob.id)).toBe(before);

    // Stored as overrides, read back whole.
    const stored = await ctx.repos.users.findById(bob.id);
    expect(stored?.notificationPreferences).toEqual({
      'content.rejected': { inApp: false, email: false },
    });
    const resolved = await ctx.notifications.preferences(bob.id);
    expect(resolved['content.rejected']).toEqual({ inApp: false, email: false, push: true });
    expect(resolved['content.approved']).toEqual({ inApp: true, email: true, push: true });
  });

  it('skips a banned account', async () => {
    await ctx.repos.users.setBanned(alice.id, true, 'gone');
    const result = await ctx.notifications.notify({
      kind: 'content.approved',
      recipients: [alice.id],
      title: 'x',
    });
    expect(result.inApp).toEqual([]);
    await ctx.repos.users.setBanned(alice.id, false, null);
  });
});

describe('the inbox', () => {
  it('lists newest first, marks read, and never reaches across accounts', async () => {
    const mine = await ctx.notifications.notify({
      kind: 'member.granted',
      recipients: [alice.id],
      title: 'Mine',
    });
    const id = mine.inApp[0]?.id as string;

    const page = await ctx.notifications.list(alice.id);
    expect(page.items[0]?.id).toBe(id);
    expect(page.items[0]?.readAt).toBeNull();

    // Bob cannot read or mark Alice's row.
    expect(await ctx.notifications.markRead(bob.id, [id])).toBe(0);
    await expect(ctx.notifications.get(bob.id, id)).rejects.toMatchObject({
      key: 'notification.notFound',
    });

    expect(await ctx.notifications.markRead(alice.id, [id])).toBe(1);
    expect((await ctx.notifications.get(alice.id, id)).readAt).not.toBeNull();
    expect((await ctx.notifications.list(alice.id, { unreadOnly: true })).items).not.toContainEqual(
      expect.objectContaining({ id }),
    );

    expect(await ctx.notifications.markUnread(alice.id, [id])).toBe(1);
    expect(await ctx.notifications.markAllRead(alice.id)).toBeGreaterThanOrEqual(1);
    expect(await ctx.notifications.deleteRead(alice.id)).toBe(true);
    expect(await ctx.notifications.unreadCount(alice.id)).toBe(0);
  });
});

describe('push subscriptions', () => {
  it('offers the public key, keeps one row per browser and refuses non-https endpoints', async () => {
    expect(ctx.notifications.catalog()).toMatchObject({
      available: { push: true },
      pushPublicKey: 'test-public-key',
    });

    const keys = { p256dh: 'p', auth: 'a' };
    await ctx.notifications.subscribe(alice.id, { endpoint: 'https://push.test/one', keys }, 'UA');
    await ctx.notifications.subscribe(alice.id, { endpoint: 'https://push.test/one', keys }, 'UA2');
    const rows = await ctx.notifications.subscriptions(alice.id);
    expect(rows.filter((row) => row.endpoint === 'https://push.test/one')).toHaveLength(1);
    await expect(
      ctx.notifications.subscribe(alice.id, { endpoint: 'http://push.test/two', keys }, null),
    ).rejects.toMatchObject({ key: 'push.subscriptionInvalid' });

    await ctx.notifications.unsubscribe(alice.id, 'https://push.test/one');
    expect(
      (await ctx.notifications.subscriptions(alice.id)).map((row) => row.endpoint),
    ).not.toContain('https://push.test/one');
  });
});

describe('what the hooks report', () => {
  it('tells someone they were added to a space, and again when their role changes', async () => {
    await ctx.spaces.grant(ctx.spaceId, alice.id, 'author');
    await ctx.spaces.grant(ctx.spaceId, alice.id, 'author');
    await ctx.spaces.grant(ctx.spaceId, alice.id, 'editor');

    const page = await ctx.notifications.list(alice.id, { kinds: ['member.granted'] });
    expect(page.items.map((row) => row.title)).toEqual([
      'Your role in S is now editor',
      'You were added to S as author',
    ]);
    expect(page.items[0]?.spaceId).toBe(ctx.spaceId);
  });
});
