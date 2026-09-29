import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { notificationRouter } from '../src/routers/notification.js';
import { failure, invoke, stubContext } from './helpers/rpc.js';

/** The service is a mock. */
function service() {
  return {
    catalog: vi.fn(),
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    markUnread: vi.fn(),
    markAllRead: vi.fn(),
    delete: vi.fn(),
    deleteRead: vi.fn(),
    preferences: vi.fn(),
    setPreferences: vi.fn(),
  };
}

describe('the inbox', () => {
  it('refuses an anonymous caller', async () => {
    const ctx = stubContext({ notifications: service() as never, principal: null });
    expect(await failure(invoke(notificationRouter.list, {}, ctx))).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('lists as the caller, with the defaults filled in', async () => {
    const notifications = service();
    notifications.list.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });
    const ctx = stubContext({ notifications: notifications as never });
    await invoke(notificationRouter.list, undefined, ctx);
    expect(notifications.list).toHaveBeenCalledWith(
      ids.user,
      { unreadOnly: false, kinds: undefined, spaceId: undefined },
      { limit: 25, offset: 0 },
    );

    await invoke(
      notificationRouter.list,
      { unreadOnly: true, kinds: ['content.approved'], pagination: { limit: 5, offset: 10 } },
      ctx,
    );
    expect(notifications.list).toHaveBeenLastCalledWith(
      ids.user,
      { unreadOnly: true, kinds: ['content.approved'], spaceId: undefined },
      { limit: 5, offset: 10 },
    );
  });

  it('rejects a kind the catalogue does not name', async () => {
    const ctx = stubContext({ notifications: service() as never });
    expect(
      await failure(invoke(notificationRouter.list, { kinds: ['content.exploded'] }, ctx)),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('marks, unmarks and deletes only as the caller', async () => {
    const notifications = service();
    notifications.markRead.mockResolvedValue(1);
    notifications.markUnread.mockResolvedValue(1);
    notifications.delete.mockResolvedValue(true);
    notifications.markAllRead.mockResolvedValue(3);
    notifications.unreadCount.mockResolvedValue(2);
    const ctx = stubContext({ notifications: notifications as never });

    expect(await invoke(notificationRouter.markRead, { ids: [ids.notification] }, ctx)).toEqual({
      changed: 1,
    });
    expect(notifications.markRead).toHaveBeenCalledWith(ids.user, [ids.notification]);
    await invoke(notificationRouter.markUnread, { ids: [ids.notification] }, ctx);
    expect(notifications.markUnread).toHaveBeenCalledWith(ids.user, [ids.notification]);
    expect(await invoke(notificationRouter.delete, { ids: [ids.notification] }, ctx)).toEqual({
      ok: true,
    });
    expect(await invoke(notificationRouter.markAllRead, undefined, ctx)).toEqual({ changed: 3 });
    expect(await invoke(notificationRouter.unreadCount, undefined, ctx)).toEqual({ count: 2 });

    expect(await failure(invoke(notificationRouter.markRead, { ids: [] }, ctx))).toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('preferences', () => {
  it("reads and writes the caller's own table", async () => {
    const notifications = service();
    notifications.preferences.mockResolvedValue({});
    notifications.setPreferences.mockResolvedValue({});
    const ctx = stubContext({ notifications: notifications as never });

    await invoke(notificationRouter.preferences, undefined, ctx);
    expect(notifications.preferences).toHaveBeenCalledWith(ids.user);

    await invoke(
      notificationRouter.setPreferences,
      { preferences: { 'content.approved': { email: false } } },
      ctx,
    );
    expect(notifications.setPreferences).toHaveBeenCalledWith(ids.user, {
      'content.approved': { email: false },
    });
  });

  it('rejects an unknown kind or channel in the table', async () => {
    const ctx = stubContext({ notifications: service() as never });
    expect(
      await failure(
        invoke(notificationRouter.setPreferences, { preferences: { nope: { email: true } } }, ctx),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await failure(
        invoke(
          notificationRouter.setPreferences,
          { preferences: { 'content.approved': { fax: true } } },
          ctx,
        ),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('push subscriptions', () => {
  it("are always the caller's own, whatever the input says", async () => {
    const notifications = { subscriptions: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    notifications.subscriptions.mockResolvedValue([]);
    notifications.subscribe.mockResolvedValue({ endpoint: 'https://push.example/1' });
    notifications.unsubscribe.mockResolvedValue(undefined);
    const headers = new Headers({ 'user-agent': 'Test/1.0' });
    const ctx = stubContext({ notifications: notifications as never, headers });

    await invoke(notificationRouter.pushSubscriptions, undefined, ctx);
    expect(notifications.subscriptions).toHaveBeenCalledWith(ids.user);

    const subscription = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
    await invoke(notificationRouter.pushSubscribe, subscription, ctx);
    expect(notifications.subscribe).toHaveBeenCalledWith(ids.user, subscription, 'Test/1.0');

    expect(
      await invoke(notificationRouter.pushUnsubscribe, { endpoint: subscription.endpoint }, ctx),
    ).toEqual({ ok: true });
    expect(notifications.unsubscribe).toHaveBeenCalledWith(ids.user, subscription.endpoint);
  });
});
