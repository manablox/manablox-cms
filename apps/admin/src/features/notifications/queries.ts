import { api } from '@manablox/admin-sdk/lib/api';
import type { Notification, NotificationPreferences } from '@manablox/admin-sdk/lib/api-types';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';
import { nextOffset } from '@manablox/admin-sdk/lib/space-query';
import { optimistic, writes } from '@manablox/admin-sdk/lib/writes';
import { type InfiniteData, type QueryKey, useInfiniteQuery, useQuery } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';

export type { Notification, NotificationPreferences } from '@manablox/admin-sdk/lib/api-types';

export interface InboxFilter {
  unreadOnly: boolean;
  limit: number;
}

/** The caller's inbox, newest first. */
export function useNotifications(filter: MaybeRefOrGetter<InboxFilter>) {
  return useQuery({
    queryKey: computed(() => keys.notifications.list(toValue(filter))),
    queryFn: () => {
      const { unreadOnly, limit } = toValue(filter);
      return api.notifications.list({ unreadOnly, pagination: { limit, offset: 0 } });
    },
  });
}

/** Inbox page size; more load on `Show more`. */
const INBOX_PAGE_SIZE = 50;

/** The inbox, paged; the server caps a page at a hundred. */
export function useNotificationInbox(unreadOnly: MaybeRefOrGetter<boolean>) {
  return useInfiniteQuery({
    queryKey: computed(() => keys.notifications.list({ unreadOnly: toValue(unreadOnly) })),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.notifications.list({
        unreadOnly: toValue(unreadOnly),
        pagination: { limit: INBOX_PAGE_SIZE, offset: pageParam },
      }),
    getNextPageParam: nextOffset,
  });
}

/** The bell's count. Updated live, with a slow poll as fallback. */
export function useUnreadCount() {
  return useQuery({
    queryKey: keys.notifications.unread(),
    queryFn: async () => (await api.notifications.unreadCount()).count,
    refetchInterval: 120_000,
  });
}

export function useNotificationCatalog() {
  return useQuery({
    queryKey: keys.notifications.catalog(),
    queryFn: () => api.notifications.catalog(),
    staleTime: 5 * 60_000,
  });
}

/** The caller's push subscriptions. */
export function usePushSubscriptions() {
  return useQuery({
    queryKey: keys.notifications.pushSubscriptions(),
    queryFn: () => api.notifications.pushSubscriptions(),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: keys.notifications.preferences(),
    queryFn: () => api.notifications.preferences(),
  });
}

type InboxPage = { items: Notification[]; total: number; offset: number };
type InboxData = InboxPage | InfiniteData<InboxPage, number>;

const LISTS = keys.notifications.lists();

/** Whether a cached list shows unread rows only, from its key. */
const unreadOnlyOf = (key: QueryKey) =>
  Boolean((key[2] as { unreadOnly?: boolean } | undefined)?.unreadOnly);

/** Row edits: the row to keep, or null to drop it from that list. */
type RowEdit = (row: Notification, unreadOnly: boolean) => Notification | null;

/** Applies `edit` to a list's pages; later pages shift back by the rows dropped before them. */
function editPages(pages: InboxPage[], edit: RowEdit, unreadOnly: boolean): InboxPage[] {
  let dropped = 0;
  const edited = pages.map((page) => {
    const offset = page.offset - dropped;
    const items: Notification[] = [];
    for (const row of page.items) {
      const next = edit(row, unreadOnly);
      if (next) items.push(next);
      else dropped++;
    }
    return { ...page, offset, items };
  });
  return edited.map((page) => ({ ...page, total: Math.max(0, page.total - dropped) }));
}

/** Every cached inbox row, by id. */
function cachedRows(): Map<string, Notification> {
  const rows = new Map<string, Notification>();
  for (const [, data] of queryClient.getQueriesData<InboxData>({ queryKey: LISTS })) {
    const pages = data ? ('pages' in data ? data.pages : [data]) : [];
    for (const row of pages.flatMap((page) => page.items)) rows.set(row.id, row);
  }
  return rows;
}

/**
 * Runs an inbox write with its outcome already in the cache: rows edited, the unread count
 * lowered by `unreadDrop`. Rolls back on failure; on success the lists go stale without a
 * refetch and the count refetches.
 */
async function inboxWrite(
  edit: RowEdit,
  unreadDrop: number | 'all',
  write: () => Promise<unknown>,
) {
  const rollbacks = [
    await optimistic<InboxData>(LISTS, (data, key) => {
      const unreadOnly = unreadOnlyOf(key);
      if (!('pages' in data)) return editPages([data], edit, unreadOnly)[0] as InboxPage;
      const pages = editPages(data.pages, edit, unreadOnly);
      return { pages, pageParams: pages.map((page) => page.offset) };
    }),
    await optimistic<number>(keys.notifications.unread(), (count) =>
      unreadDrop === 'all' ? 0 : Math.max(0, count - unreadDrop),
    ),
  ];
  try {
    await write();
  } catch (error) {
    for (const rollback of rollbacks) rollback();
    throw error;
  }
  void queryClient.invalidateQueries({ queryKey: LISTS, refetchType: 'none' });
  void queryClient.invalidateQueries({ queryKey: keys.notifications.unread() });
}

/** How many distinct `ids` the cache holds with `readAt` matching `unread`. */
const cachedCount = (ids: string[], unread: boolean) => {
  const rows = cachedRows();
  return [...new Set(ids)].filter((id) => {
    const row = rows.get(id);
    return row !== undefined && (row.readAt === null) === unread;
  }).length;
};

/** Unread-only lists gain or lose rows only the server can place. */
const refetchUnreadOnly = () =>
  void queryClient.invalidateQueries({
    queryKey: LISTS,
    predicate: (query) => unreadOnlyOf(query.queryKey),
  });

const markedRead = (row: Notification, unreadOnly: boolean) =>
  unreadOnly ? null : row.readAt === null ? { ...row, readAt: new Date() } : row;

/** Inbox writes, applied to the cache before the server answers. */
export const notifications = {
  markRead(ids: string[]): Promise<void> {
    const wanted = new Set(ids);
    return inboxWrite(
      (row, unreadOnly) => (wanted.has(row.id) ? markedRead(row, unreadOnly) : row),
      cachedCount(ids, true),
      () => api.notifications.markRead({ ids }),
    );
  },
  async markUnread(ids: string[]): Promise<void> {
    const wanted = new Set(ids);
    await inboxWrite(
      (row) => (wanted.has(row.id) ? { ...row, readAt: null } : row),
      -cachedCount(ids, false),
      () => api.notifications.markUnread({ ids }),
    );
    refetchUnreadOnly();
  },
  async markAllRead(): Promise<void> {
    await inboxWrite(markedRead, 'all', () => api.notifications.markAllRead());
    refetchUnreadOnly();
  },
  remove(ids: string[]): Promise<void> {
    const wanted = new Set(ids);
    return inboxWrite(
      (row) => (wanted.has(row.id) ? null : row),
      cachedCount(ids, true),
      () => api.notifications.delete({ ids }),
    );
  },
  removeRead(): Promise<void> {
    return inboxWrite(
      (row) => (row.readAt === null ? row : null),
      0,
      () => api.notifications.deleteRead(),
    );
  },
  setPreferences: writes(invalidate.notifications)(
    (preferences: NotificationPreferences): Promise<NotificationPreferences> =>
      api.notifications.setPreferences({ preferences }),
  ),
};

export const pushSubscriptions = {
  async unsubscribe(endpoint: string): Promise<void> {
    await api.notifications.pushUnsubscribe({ endpoint });
    invalidate.pushSubscriptions();
  },
};
