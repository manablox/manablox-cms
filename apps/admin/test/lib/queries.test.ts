import { QueryObserver } from '@tanstack/vue-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@manablox/admin-sdk/lib/api', () => ({ api: {} }));
vi.mock('@manablox/admin-sdk/stores/space', () => ({
  useSpaceStore: () => ({ currentId: 'space-1' }),
}));

import { invalidate, onInvalidated, onPromoted } from '@manablox/admin-sdk/lib/invalidate';
import { keys } from '@manablox/admin-sdk/lib/keys';
import { queryClient } from '@manablox/admin-sdk/lib/query-client';

const level = (ids: string[]) => ({
  pages: [
    { items: ids.map((id) => ({ content: { id }, childCount: 0 })), offset: 0, total: ids.length },
  ],
  pageParams: [0],
});

/** Whether the cached query under `key` was marked stale. */
const invalidated = (key: readonly unknown[]) =>
  queryClient.getQueryCache().find({ queryKey: key })?.state.isInvalidated ?? null;

beforeEach(() => {
  queryClient.clear();
});

describe('invalidate.content with document ids', () => {
  const space = 'space-1';
  const rootLevel = keys.content.tree(space, 'en', null);
  const folderLevel = keys.content.tree(space, 'en', 'folder');
  const otherLevel = keys.content.tree(space, 'en', 'other');

  beforeEach(() => {
    queryClient.setQueryData(rootLevel, level(['folder', 'other']));
    queryClient.setQueryData(folderLevel, level(['doc-1', 'doc-2']));
    queryClient.setQueryData(otherLevel, level(['doc-3']));
    queryClient.setQueryData(keys.content.versions(space, 'doc-1'), []);
    queryClient.setQueryData(keys.content.versions(space, 'doc-3'), []);
    queryClient.setQueryData(keys.content.approval(space, 'doc-1'), null);
    queryClient.setQueryData(keys.content.ancestors(space, 'doc-3'), []);
    queryClient.setQueryData(keys.content.byIds(space, ['doc-1', 'doc-3']), []);
    queryClient.setQueryData(keys.content.byIds(space, ['doc-3']), []);
    queryClient.setQueryData(keys.content.recent(space, 'en'), { items: [] });
    queryClient.setQueryData(keys.content.tree('space-2', 'en', null), level(['doc-1']));
  });

  it('marks the tree level listing the document stale and leaves the others', () => {
    invalidate.content(space, ['doc-1']);
    expect(invalidated(folderLevel)).toBe(true);
    expect(invalidated(rootLevel)).toBe(false);
    expect(invalidated(otherLevel)).toBe(false);
    expect(invalidated(keys.content.tree('space-2', 'en', null))).toBe(false);
  });

  it("marks the document's own keys stale and leaves other documents' keys", () => {
    invalidate.content(space, ['doc-1']);
    expect(invalidated(keys.content.versions(space, 'doc-1'))).toBe(true);
    expect(invalidated(keys.content.approval(space, 'doc-1'))).toBe(true);
    expect(invalidated(keys.content.versions(space, 'doc-3'))).toBe(false);
    expect(invalidated(keys.content.ancestors(space, 'doc-3'))).toBe(false);
    expect(invalidated(keys.content.byIds(space, ['doc-1', 'doc-3']))).toBe(true);
    expect(invalidated(keys.content.byIds(space, ['doc-3']))).toBe(false);
  });

  it('always marks the list queries stale', () => {
    invalidate.content(space, ['doc-1']);
    expect(invalidated(keys.content.recent(space, 'en'))).toBe(true);
  });

  it('covers every document in the batch', () => {
    invalidate.content(space, ['doc-1', 'doc-3']);
    expect(invalidated(folderLevel)).toBe(true);
    expect(invalidated(otherLevel)).toBe(true);
    expect(invalidated(rootLevel)).toBe(false);
  });

  it('marks the whole space stale without ids', () => {
    invalidate.content(space);
    expect(invalidated(rootLevel)).toBe(true);
    expect(invalidated(otherLevel)).toBe(true);
    expect(invalidated(keys.content.tree('space-2', 'en', null))).toBe(false);
  });
});

describe('audit invalidation on writes', () => {
  const log = keys.audit.list('space-1', {});

  beforeEach(() => {
    queryClient.setQueryData(log, { items: [] });
    queryClient.setQueryData(keys.audit.catalog(), { actions: [] });
    queryClient.setQueryData(keys.roles.all('space-1'), []);
  });

  it('leaves the log alone while no audit view is mounted', () => {
    invalidate.roles('space-1');
    expect(invalidated(keys.roles.all('space-1'))).toBe(true);
    expect(invalidated(log)).toBe(false);
  });

  it('marks the log stale while an audit view observes it, but never the catalogue', () => {
    const observer = new QueryObserver(queryClient, { queryKey: log, enabled: false });
    const unsubscribe = observer.subscribe(() => {});
    invalidate.roles('space-1');
    unsubscribe();
    expect(invalidated(log)).toBe(true);
    expect(invalidated(keys.audit.catalog())).toBe(false);
  });
});

describe('invalidate.contentTypes', () => {
  it('marks multi-space type lists holding the space stale', async () => {
    queryClient.setQueryData(keys.contentTypes.list('space-1'), []);
    queryClient.setQueryData(keys.contentTypes.many(['space-2', 'space-1']), []);
    queryClient.setQueryData(keys.contentTypes.many(['space-2']), []);
    await invalidate.contentTypes('space-1');
    expect(invalidated(keys.contentTypes.list('space-1'))).toBe(true);
    expect(invalidated(keys.contentTypes.many(['space-1', 'space-2']))).toBe(true);
    expect(invalidated(keys.contentTypes.many(['space-2']))).toBe(false);
  });
});

const S = 'space-1';

/** One sample key per key function, grouped by the invalidation that must cover it. */
const covered: Record<string, [() => unknown, Record<string, readonly unknown[]>]> = {
  content: [
    () => invalidate.content(S),
    {
      'content.tree': keys.content.tree(S, 'en', 'p'),
      'content.ancestors': keys.content.ancestors(S, 'c'),
      'content.search': keys.content.search(S, 'en', 'term', ['t']),
      'content.recent': keys.content.recent(S, 'en'),
      'content.byIds': keys.content.byIds(S, ['c']),
      'content.picker': keys.content.picker(S, 'en', 'term', ['t']),
      'content.treeSearch': keys.content.treeSearch(S, 'en', 'term', ['t']),
      'content.translations': keys.content.translations(S, 'c'),
      'content.versions': keys.content.versions(S, 'c'),
      'content.versionPage': keys.content.versionPage(S, 'c', 1),
      'content.approval': keys.content.approval(S, 'c'),
      'content.pendingApprovals': keys.content.pendingApprovals(S),
      'content.templates': keys.content.templates(S, 'en'),
      'content.databag': keys.content.databag(S, 't', 'en', { search: '', page: 0 }),
      'content.databagCounts': keys.content.databagCounts(S, 'en', ['t']),
      'content.relationPreview': keys.content.relationPreview(S, 'en', { limit: 10 }),
    },
  ],
  contentTypes: [
    () => invalidate.contentTypes(S),
    {
      'contentTypes.list': keys.contentTypes.list(S),
      'contentTypes.many': keys.contentTypes.many(['other', S]),
    },
  ],
  roles: [() => invalidate.roles(S), { 'roles.all': keys.roles.all(S) }],
  menus: [
    () => invalidate.menus(S),
    {
      'menus.list': keys.menus.list(S),
      'menus.detail': keys.menus.detail(S, 'm', 'en'),
      'menus.usedIn': keys.menus.usedIn(S, 'l'),
      'menus.placements': keys.menus.placements(S, 'l', 'en'),
    },
  ],
  redirects: [
    () => invalidate.redirects(S),
    { 'redirects.page': keys.redirects.page(S, { page: 0 }) },
  ],
  credentials: [
    () => invalidate.credentials(S),
    {
      'credentials.list': keys.credentials.list(S),
      'credentials.page': keys.credentials.page(S, { page: 0 }),
    },
  ],
  pushSubscriptions: [
    () => invalidate.pushSubscriptions(),
    { 'notifications.pushSubscriptions': keys.notifications.pushSubscriptions() },
  ],
  tags: [
    () => invalidate.tags(S),
    {
      'tags.list': keys.tags.list(S, ''),
      'tags.counts': keys.tags.counts(S, ''),
      'tags.ofContent': keys.tags.ofContent(S, ['c']),
      'assets.list': keys.assets.list(S, {
        search: '',
        mimeType: null,
        tagIds: [],
        mimeTypeNot: [],
      }),
      'content.recent': keys.content.recent(S, 'en'),
    },
  ],
  tagVocabulary: [
    () => invalidate.tagVocabulary(S),
    { 'tags.list': keys.tags.list(S, 'a'), 'tags.counts': keys.tags.counts(S, 'a') },
  ],
  assets: [
    () => invalidate.assets(S),
    {
      'assets.list': keys.assets.list(S, {
        search: 'x',
        mimeType: 'image/',
        tagIds: ['t'],
        mimeTypeNot: [],
      }),
      'assets.byIds': keys.assets.byIds(S, ['a']),
      'assets.limits': keys.assets.limits(S),
      'assets.presets': keys.assets.presets(S),
      'assets.relationPreview': keys.assets.relationPreview(S, { mimeType: 'image/' }),
    },
  ],
  members: [
    () => invalidate.members(S),
    {
      'spaces.members': keys.spaces.members(S),
      'spaces.candidates': keys.spaces.candidates(S, 'a'),
      'users.list': keys.users.list(''),
    },
  ],
  spaces: [
    () => invalidate.spaces([S]),
    {
      'spaces.all': keys.spaces.all(),
      'spaces.inventory': keys.spaces.inventory(S),
      'spaces.configInventory': keys.spaces.configInventory(S),
      'assets.limits': keys.assets.limits(S),
    },
  ],
  users: [
    () => invalidate.users(),
    { 'users.list': keys.users.list('a'), 'users.detail': keys.users.detail('u') },
  ],
  apiKeys: [() => invalidate.apiKeys(), { 'apiKeys.all': keys.apiKeys.all() }],
  invitations: [() => invalidate.invitations(), { 'invitations.list': keys.invitations.list(S) }],
  ssoProviders: [
    () => invalidate.ssoProviders(),
    { 'instance.ssoProviders': keys.instance.ssoProviders() },
  ],
  apiHosts: [() => invalidate.apiHosts(S), { 'spaces.apiHosts': keys.spaces.apiHosts(S) }],
  environments: [
    () => invalidate.environments(S),
    {
      'environments.list': keys.environments.list(S),
      'environments.diff': keys.environments.diff(S, 'staging', 'config'),
    },
  ],
  snapshots: [() => invalidate.snapshots(S), { 'snapshots.list': keys.snapshots.list(S) }],
  notifications: [
    () => invalidate.notifications(),
    {
      'notifications.list': keys.notifications.list({ unreadOnly: true, limit: 8 }),
      'notifications.unread': keys.notifications.unread(),
      'notifications.catalog': keys.notifications.catalog(),
      'notifications.preferences': keys.notifications.preferences(),
    },
  ],
  audit: [
    () => invalidate.audit(),
    {
      'audit.list': keys.audit.list(S, { filter: {}, page: 0 }),
      'audit.instance': keys.audit.instance({ mode: 'instance', page: 0 }),
      'audit.catalog': keys.audit.catalog(),
    },
  ],
};

/** Invalidations that reach every space. */
const instanceWide = new Set(['spaces', 'audit', 'invitations', 'ssoProviders']);

/**
 * Prefix helpers, catalogues that change only with a release, usage, which no write sets, and
 * keys their writes set directly.
 */
const exempt = new Set([
  'all',
  'root',
  'lists',
  'everyMany',
  'candidateSearches',
  'spaces.allApiHosts',
  'contentTypes.fieldTypes',
  'roles.catalog',
  'usage.space',
  'usage.instance',
  'preferences.get',
  'instance.settings',
]);

describe('plugin keys', () => {
  it("invalidate.own marks the caller's key stale", () => {
    queryClient.setQueryData(['plugin', S, 'list'], {});
    invalidate.own(['plugin', S]);
    expect(invalidated(['plugin', S, 'list'])).toBe(true);
  });

  it('tells promote listeners after a promote, until they unsubscribe', () => {
    const heard: (string | null)[] = [];
    const stop = onPromoted((spaceId) => heard.push(spaceId));
    invalidate.promoted(S);
    stop();
    invalidate.promoted(S);
    expect(heard).toEqual([S]);
  });

  it("tells a kind's listeners after its writes, until they unsubscribe", () => {
    const heard: string[] = [];
    const stop = onInvalidated('credentials', (spaceId) => heard.push(`credentials:${spaceId}`));
    invalidate.credentials(S);
    invalidate.menus(S);
    stop();
    invalidate.credentials(S);
    expect(heard).toEqual([`credentials:${S}`]);
  });
});

describe('query keys', () => {
  it('has a covering invalidation for every key function', () => {
    const sampled = new Set(Object.values(covered).flatMap(([, samples]) => Object.keys(samples)));
    const missing = Object.entries(keys)
      .flatMap(([group, fns]) => Object.keys(fns).map((name) => [group, name] as const))
      .filter(([group, name]) => !exempt.has(name) && !exempt.has(`${group}.${name}`))
      .map(([group, name]) => `${group}.${name}`)
      .filter((label) => !sampled.has(label));
    expect(missing).toEqual([]);
  });

  for (const [name, [run, samples]] of Object.entries(covered)) {
    it(`invalidate.${name} marks every key it owns stale`, async () => {
      for (const key of Object.values(samples)) queryClient.setQueryData(key, {});
      // Another space's copy stays fresh, unless the invalidation spans every space.
      const foreign = Object.values(samples)
        .filter((key) => key[1] === S && !instanceWide.has(name))
        .map((key) => [key[0], 'space-2', ...key.slice(2)] as const);
      for (const key of foreign) queryClient.setQueryData(key, {});
      await run();
      for (const [label, key] of Object.entries(samples)) {
        expect([label, invalidated(key)]).toEqual([label, true]);
      }
      for (const key of foreign) expect(invalidated(key)).toBe(false);
    });
  }

  it('hashes params objects by value, so equal params share one entry', () => {
    queryClient.setQueryData(keys.content.databag(S, 't', 'en', { page: 0, search: 'a' }), 1);
    expect(
      queryClient.getQueryData(keys.content.databag(S, 't', 'en', { search: 'a', page: 0 })),
    ).toBe(1);
  });
});
