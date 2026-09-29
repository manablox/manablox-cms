import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  notifications: {
    markRead: vi.fn(),
    markUnread: vi.fn(),
    markAllRead: vi.fn(),
    delete: vi.fn(),
    deleteRead: vi.fn(),
  },
}));
vi.mock('@manablox/admin-sdk/lib/api', () => ({ api }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 'space-1' }),
}));

import { pending, settle } from '@manablox/admin-sdk/lib/confirm';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { optimistic } from '@manablox/admin-sdk/lib/writes';
import NotificationItem from '~/features/notifications/components/NotificationItem.vue';
import { notifications } from '~/features/notifications/queries';

const row = (id: string, read = false) => ({ id, readAt: read ? new Date(0) : null });
const page = (ids: [string, boolean][], offset: number, total: number) => ({
  items: ids.map(([id, read]) => row(id, read)),
  offset,
  total,
});

const allKey = keys.notifications.list({ unreadOnly: false });
const unreadKey = keys.notifications.list({ unreadOnly: true });
const bellKey = keys.notifications.list({ unreadOnly: false, limit: 8 });

const ids = (key: readonly unknown[]) => {
  const data = queryClient.getQueryData<{ pages: { items: { id: string }[] }[] }>(key);
  return data?.pages.map((p) => p.items.map((item) => item.id));
};
const readIds = (key: readonly unknown[]) =>
  queryClient
    .getQueryData<{ pages: { items: { id: string; readAt: unknown }[] }[] }>(key)
    ?.pages.flatMap((p) => p.items.filter((item) => item.readAt !== null).map((item) => item.id));
const isInvalidated = (key: readonly unknown[]) =>
  queryClient.getQueryCache().find({ queryKey: key })?.state.isInvalidated;

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  queryClient.setQueryData(allKey, {
    pages: [
      page(
        [
          ['a', false],
          ['b', true],
        ],
        0,
        4,
      ),
      page(
        [
          ['c', false],
          ['d', true],
        ],
        2,
        4,
      ),
    ],
    pageParams: [0, 2],
  });
  queryClient.setQueryData(unreadKey, {
    pages: [page([['a', false]], 0, 2), page([['c', false]], 1, 2)],
    pageParams: [0, 1],
  });
  queryClient.setQueryData(bellKey, page([['a', false]], 0, 4));
  queryClient.setQueryData(keys.notifications.unread(), 2);
});

describe('optimistic', () => {
  it('rewrites every query under the key and restores them on rollback', async () => {
    queryClient.setQueryData(['x', 1], 1);
    queryClient.setQueryData(['x', 2], 2);
    const rollback = await optimistic<number>(['x'], (n) => n * 10);
    expect(queryClient.getQueryData(['x', 1])).toBe(10);
    expect(queryClient.getQueryData(['x', 2])).toBe(20);
    rollback();
    expect(queryClient.getQueryData(['x', 1])).toBe(1);
    expect(queryClient.getQueryData(['x', 2])).toBe(2);
  });
});

describe('notification writes', () => {
  it('marks a row read in place, drops it from unread-only lists, and lowers the count', async () => {
    api.notifications.markRead.mockResolvedValue({ changed: 1 });
    await notifications.markRead(['a']);

    expect(readIds(allKey)).toEqual(['a', 'b', 'd']);
    expect(ids(unreadKey)).toEqual([[], ['c']]);
    const unread = queryClient.getQueryData<{
      pages: { offset: number; total: number }[];
      pageParams: number[];
    }>(unreadKey);
    // The later page moves back by the row dropped before it.
    expect(unread?.pages.map((p) => [p.offset, p.total])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(unread?.pageParams).toEqual([0, 0]);
    expect(
      queryClient.getQueryData<{ items: { readAt: unknown }[] }>(bellKey)?.items[0]?.readAt,
    ).not.toBeNull();
    expect(queryClient.getQueryData(keys.notifications.unread())).toBe(1);
  });

  it('marks the lists stale without refetching and refetches only the count', async () => {
    api.notifications.markRead.mockResolvedValue({ changed: 1 });
    await notifications.markRead(['a']);
    expect(isInvalidated(allKey)).toBe(true);
    expect(isInvalidated(keys.notifications.unread())).toBe(true);
  });

  it('puts the cache back when the write fails', async () => {
    api.notifications.markRead.mockRejectedValue(new Error('down'));
    await expect(notifications.markRead(['a', 'c'])).rejects.toThrow('down');
    expect(readIds(allKey)).toEqual(['b', 'd']);
    expect(ids(unreadKey)).toEqual([['a'], ['c']]);
    expect(queryClient.getQueryData(keys.notifications.unread())).toBe(2);
    expect(isInvalidated(allKey)).toBe(false);
  });

  it('marks everything read and zeroes the count', async () => {
    api.notifications.markAllRead.mockResolvedValue({ changed: 2 });
    await notifications.markAllRead();
    expect(readIds(allKey)).toEqual(['a', 'b', 'c', 'd']);
    expect(queryClient.getQueryData(keys.notifications.unread())).toBe(0);
  });

  it('marks a row unread and raises the count', async () => {
    api.notifications.markUnread.mockResolvedValue({ changed: 1 });
    await notifications.markUnread(['b']);
    expect(readIds(allKey)).toEqual(['d']);
    expect(queryClient.getQueryData(keys.notifications.unread())).toBe(3);
  });

  it('removes rows, shrinking totals and shifting later pages', async () => {
    api.notifications.delete.mockResolvedValue({ ok: true });
    await notifications.remove(['a', 'b']);
    expect(ids(allKey)).toEqual([[], ['c', 'd']]);
    const all = queryClient.getQueryData<{ pages: { offset: number; total: number }[] }>(allKey);
    expect(all?.pages.map((p) => [p.offset, p.total])).toEqual([
      [0, 2],
      [0, 2],
    ]);
    expect(queryClient.getQueryData(keys.notifications.unread())).toBe(1);
  });

  it('removes a row from its delete button only after the confirm', async () => {
    api.notifications.delete.mockResolvedValue({ ok: true });
    const wrapper = mount(NotificationItem, {
      props: {
        notification: { ...row('a'), title: 'Approve', kind: 'x', createdAt: new Date() } as never,
      },
      global: { stubs: { RouterLink: true } },
    });
    const button = wrapper.get('[aria-label="Delete notification"]');

    await button.trigger('click');
    expect(pending.value?.danger).toBe(true);
    settle(false);
    await vi.waitFor(() => expect(pending.value).toBeNull());
    expect(api.notifications.delete).not.toHaveBeenCalled();
    expect(ids(allKey)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);

    await button.trigger('click');
    settle(true);
    await vi.waitFor(() => expect(api.notifications.delete).toHaveBeenCalledWith({ ids: ['a'] }));
    expect(ids(allKey)?.[0]).toEqual(['b']);
  });

  it('removes the read rows and keeps the count', async () => {
    api.notifications.deleteRead.mockResolvedValue({ ok: true });
    await notifications.removeRead();
    expect(ids(allKey)).toEqual([['a'], ['c']]);
    expect(queryClient.getQueryData(keys.notifications.unread())).toBe(2);
  });
});
