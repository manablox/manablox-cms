import type { InfiniteData, Query, QueryKey } from '@tanstack/vue-query';
import { environmentOf } from './environment';
import { keys } from './keys';
import { queryClient } from './query-client';

/** Every log query but the catalogue. */
const isAuditLog = (query: Query): boolean =>
  query.queryKey[0] === 'audit' && query.queryKey[1] !== 'catalog';

/** Every write adds an activity entry; the log refetches only while a view of it is mounted. */
const auditToo = (): void => {
  const cache = queryClient.getQueryCache();
  if (!cache.findAll({ predicate: isAuditLog }).some((query) => query.getObserversCount() > 0))
    return;
  void queryClient.invalidateQueries({ predicate: isAuditLog });
};

/** Whether a cached tree level lists the document. */
function treeLevelHolds(data: unknown, contentIds: ReadonlySet<string>): boolean {
  const pages = (data as InfiniteData<{ items: { content: { id: string } }[] }> | undefined)?.pages;
  return pages?.some((page) => page.items.some((item) => contentIds.has(item.content.id))) ?? false;
}

/** Whether one content query goes stale when only the given documents changed. */
function staleForDocuments(query: Query, contentIds: ReadonlySet<string>): boolean {
  const [, , , kind, ...rest] = query.queryKey;
  switch (kind) {
    case 'tree':
      return treeLevelHolds(query.state.data, contentIds);
    case 'ancestors':
    case 'translations':
    case 'versions':
    case 'approval':
      return contentIds.has(rest[0] as string);
    case 'by-id':
      return (rest[0] as readonly string[]).some((id) => contentIds.has(id));
    default:
      return true;
  }
}

const promotedListeners = new Set<(spaceId: string | null) => void>();

/** Called after a promote replaced a space's production data; returns the unsubscribe. */
export function onPromoted(listener: (spaceId: string | null) => void): () => void {
  promotedListeners.add(listener);
  return () => promotedListeners.delete(listener);
}

/** Core kinds whose writes plugins follow, e.g. to refresh a list naming credentials. */
export type InvalidatedKind = 'credentials';

const invalidatedListeners = new Map<InvalidatedKind, Set<(spaceId: string | null) => void>>();

/**
 * Called after writes of a core kind made a space's queries of it stale, so a plugin can drop
 * its own queries that list them; returns the unsubscribe.
 */
export function onInvalidated(
  kind: InvalidatedKind,
  listener: (spaceId: string | null) => void,
): () => void {
  const listeners = invalidatedListeners.get(kind) ?? new Set();
  invalidatedListeners.set(kind, listeners);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function invalidated(kind: InvalidatedKind, spaceId: string | null): void {
  for (const listener of invalidatedListeners.get(kind) ?? []) listener(spaceId);
}

/** What each kind of write makes stale. */
export const invalidate = {
  /** With `contentIds`, only those documents' keys and the tree levels listing them. */
  content(spaceId: string | null, contentIds?: readonly string[]): void {
    auditToo();
    if (!contentIds) {
      void queryClient.invalidateQueries({ queryKey: keys.content.all(spaceId) });
      return;
    }
    const ids = new Set(contentIds);
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'content' &&
        query.queryKey[1] === spaceId &&
        staleForDocuments(query, ids),
    });
  },
  members(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.spaces.members(spaceId) });
    void queryClient.invalidateQueries({ queryKey: keys.spaces.candidateSearches(spaceId) });
    // A membership is read from the user's side too.
    void queryClient.invalidateQueries({ queryKey: keys.users.all() });
  },
  /** The space list and the given spaces' upload limits. */
  spaces(spaceIds: Iterable<string | null>): void {
    void queryClient.invalidateQueries({ queryKey: keys.spaces.all() });
    for (const spaceId of spaceIds)
      void queryClient.invalidateQueries({ queryKey: keys.assets.limits(spaceId) });
  },
  apiHosts(spaceId: string): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.spaces.allApiHosts(spaceId) });
  },
  environments(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.environments.all(spaceId) });
  },
  /** A promote rewrites production's config and possibly its content. */
  promoted(spaceId: string | null): void {
    invalidate.environments(spaceId);
    invalidate.content(spaceId);
    void invalidate.contentTypes(spaceId);
    invalidate.menus(spaceId);
    invalidate.redirects(spaceId);
    invalidate.credentials(spaceId);
    void queryClient.invalidateQueries({ queryKey: keys.spaces.all() });
    for (const listener of promotedListeners) listener(spaceId);
  },
  apiKeys(): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.apiKeys.all() });
  },
  snapshots(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.snapshots.list(spaceId) });
  },
  users(): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.users.all() });
  },
  invitations(): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.invitations.all() });
  },
  ssoProviders(): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.instance.ssoProviders() });
  },
  assets(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.assets.all(spaceId) });
  },
  /** A write that may have created a tag; only the vocabulary is stale. */
  tagVocabulary(spaceId: string | null): void {
    void queryClient.invalidateQueries({ queryKey: keys.tags.all(spaceId) });
  },
  /** Tags show on documents and assets, so both listings go stale with them. */
  tags(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.tags.all(spaceId) });
    void queryClient.invalidateQueries({ queryKey: keys.assets.all(spaceId) });
    void queryClient.invalidateQueries({ queryKey: keys.content.all(spaceId) });
  },
  roles(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.roles.all(spaceId) });
  },
  contentTypes(spaceId: string | null): Promise<void> {
    auditToo();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.contentTypes.all(spaceId) }),
      queryClient.invalidateQueries({
        queryKey: keys.contentTypes.everyMany(),
        predicate: ({ queryKey }) =>
          spaceId === null || (queryKey[2] as string[] | undefined)?.includes(spaceId) === true,
      }),
    ]).then(() => undefined);
  },
  menus(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.menus.all(spaceId) });
  },
  redirects(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.redirects.all(spaceId) });
  },
  /** Also what plugins keep that lists credentials, see `onInvalidated`. */
  credentials(spaceId: string | null): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.credentials.all(spaceId) });
    invalidated('credentials', spaceId);
  },
  pushSubscriptions(): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey: keys.notifications.pushSubscriptions() });
  },
  notifications(): void {
    void queryClient.invalidateQueries({ queryKey: keys.notifications.all() });
  },
  audit(): void {
    void queryClient.invalidateQueries({ queryKey: keys.audit.root() });
  },
  /** A key of the caller's own, with the open activity log like the built-in writes. */
  own(queryKey: QueryKey): void {
    auditToo();
    void queryClient.invalidateQueries({ queryKey });
  },
};

/** A plugin's query keys under its own root; see `pluginKeys`. */
export interface PluginKeys<R extends string> {
  /** Every key of a space, in every environment. */
  all(spaceId: string | null): readonly [R, string | null];
  /** A key of a space's working environment. */
  scoped<const P extends readonly unknown[]>(
    spaceId: string | null,
    ...parts: P
  ): readonly [R, string | null, string, ...P];
  /** Drops every key of a space, with the open activity log. */
  invalidate(spaceId: string | null): void;
}

/**
 * Query keys of a plugin, nested under `root` like the admin's: `[root, spaceId]` covers a
 * space, `scoped` adds the working environment, so keys follow an environment switch.
 */
export function pluginKeys<const R extends string>(root: R): PluginKeys<R> {
  const all = (spaceId: string | null) => [root, spaceId] as const;
  return {
    all,
    scoped: (spaceId, ...parts) => [root, spaceId, environmentOf(spaceId), ...parts] as const,
    invalidate: (spaceId) => invalidate.own(all(spaceId)),
  };
}
