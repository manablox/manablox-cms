import { environmentOf } from './environment';

/** A key segment of what shapes a query; TanStack hashes it by value. */
type Params = object;

/** The environment segment of a space's key; reactive, so keys follow a switch. */
const env = (spaceId: string | null): string => environmentOf(spaceId);

/**
 * Every query key. Keys nest by prefix, so `all(...)` invalidates everything below it. Keys of
 * environment-scoped data carry the environment after the space; `all(...)` covers every one.
 */
export const keys = {
  spaces: {
    all: () => ['spaces'] as const,
    members: (spaceId: string | null) => ['spaces', spaceId, 'members'] as const,
    /** Every candidate search of a space. */
    candidateSearches: (spaceId: string | null) => ['spaces', spaceId, 'candidates'] as const,
    candidates: (spaceId: string | null, search: string) =>
      ['spaces', spaceId, 'candidates', search] as const,
    inventory: (spaceId: string | null) => ['spaces', spaceId, 'inventory', env(spaceId)] as const,
    configInventory: (spaceId: string | null) =>
      ['spaces', spaceId, 'config-inventory', env(spaceId)] as const,
    /** Every environment's API hosts. */
    allApiHosts: (spaceId: string | null) => ['spaces', spaceId, 'api-hosts'] as const,
    apiHosts: (spaceId: string | null) => ['spaces', spaceId, 'api-hosts', env(spaceId)] as const,
  },
  apiKeys: {
    all: () => ['api-keys'] as const,
  },
  environments: {
    all: (spaceId: string | null) => ['environments', spaceId] as const,
    list: (spaceId: string | null) => ['environments', spaceId, 'list'] as const,
    /** What promoting `environment` with `mode` would change in production. */
    diff: (spaceId: string | null, environment: string, mode: string) =>
      ['environments', spaceId, 'diff', environment, mode] as const,
  },
  usage: {
    space: (spaceId: string | null) => ['usage', 'space', spaceId] as const,
    instance: () => ['usage', 'instance'] as const,
  },
  snapshots: {
    list: (spaceId: string | null) => ['snapshots', spaceId] as const,
  },
  invitations: {
    all: () => ['invitations'] as const,
    /** A space's invitations; `null` lists every one. */
    list: (spaceId: string | null) => ['invitations', spaceId] as const,
  },
  preferences: {
    get: (key: string, userId: string | null) => ['preferences', key, userId] as const,
  },
  instance: {
    settings: () => ['instance', 'settings'] as const,
    ssoProviders: () => ['instance', 'ssoProviders'] as const,
  },
  users: {
    all: () => ['users'] as const,
    list: (search: string) => ['users', 'list', search] as const,
    detail: (userId: string | null) => ['users', 'detail', userId] as const,
  },
  content: {
    all: (spaceId: string | null) => ['content', spaceId] as const,
    /** One tree level, keyed by its parent; `null` is the root. */
    tree: (spaceId: string | null, locale: string, parentId: string | null = null) =>
      ['content', spaceId, env(spaceId), 'tree', locale, parentId ?? 'root'] as const,
    /** Which nodes the tree has to open to reveal a document. */
    ancestors: (spaceId: string | null, contentId: string | null) =>
      ['content', spaceId, env(spaceId), 'ancestors', contentId] as const,
    search: (
      spaceId: string | null,
      locale: string,
      term: string,
      tagIds: readonly string[] = [],
    ) => ['content', spaceId, env(spaceId), 'search', locale, term, [...tagIds]] as const,
    recent: (spaceId: string | null, locale: string) =>
      ['content', spaceId, env(spaceId), 'recent', locale] as const,
    byIds: (spaceId: string | null, ids: readonly string[]) =>
      ['content', spaceId, env(spaceId), 'by-id', [...ids]] as const,
    picker: (spaceId: string | null, locale: string, term: string, typeIds: readonly string[]) =>
      ['content', spaceId, env(spaceId), 'picker', locale, term, [...typeIds]] as const,
    treeSearch: (
      spaceId: string | null,
      locale: string,
      term: string,
      typeIds: readonly string[],
    ) => ['content', spaceId, env(spaceId), 'tree-search', locale, term, [...typeIds]] as const,
    translations: (spaceId: string | null, contentId: string) =>
      ['content', spaceId, env(spaceId), 'translations', contentId] as const,
    versions: (spaceId: string | null, contentId: string) =>
      ['content', spaceId, env(spaceId), 'versions', contentId] as const,
    versionPage: (spaceId: string | null, contentId: string, page: number) =>
      ['content', spaceId, env(spaceId), 'versions', contentId, 'page', page] as const,
    approval: (spaceId: string | null, contentId: string | null) =>
      ['content', spaceId, env(spaceId), 'approval', contentId] as const,
    pendingApprovals: (spaceId: string | null) =>
      ['content', spaceId, env(spaceId), 'pending-approvals'] as const,
    templates: (spaceId: string | null, locale: string) =>
      ['content', spaceId, env(spaceId), 'templates', locale] as const,
    /** One page of a databag's entries, keyed by what shapes it. */
    databag: (spaceId: string | null, typeId: string, locale: string, params: Params) =>
      ['content', spaceId, env(spaceId), 'databag', typeId, locale, params] as const,
    /** Entry counts per databag type. */
    databagCounts: (spaceId: string | null, locale: string, typeIds: readonly string[]) =>
      ['content', spaceId, env(spaceId), 'databag-counts', locale, [...typeIds]] as const,
    /** A `filter` relation's preview, keyed by its settings. */
    relationPreview: (spaceId: string | null, locale: string, settings: Params) =>
      ['content', spaceId, env(spaceId), 'relation-preview', locale, settings] as const,
  },
  contentTypes: {
    all: (spaceId: string | null) => ['content-types', spaceId] as const,
    list: (spaceId: string | null) => ['content-types', spaceId, env(spaceId), 'list'] as const,
    /** Every multi-space list. */
    everyMany: () => ['content-types', 'many'] as const,
    /** Several spaces at once; invalidated with any of them. */
    many: (spaceIds: readonly string[]) => ['content-types', 'many', [...spaceIds].sort()] as const,
    fieldTypes: () => ['content-types', 'field-types'] as const,
  },
  roles: {
    all: (spaceId: string | null) => ['roles', spaceId] as const,
    catalog: () => ['roles', 'catalog'] as const,
  },
  menus: {
    all: (spaceId: string | null) => ['menus', spaceId] as const,
    list: (spaceId: string | null) => ['menus', spaceId, env(spaceId), 'list'] as const,
    detail: (spaceId: string | null, id: string, locale: string) =>
      ['menus', spaceId, env(spaceId), 'detail', id, locale] as const,
    usedIn: (spaceId: string | null, localizationId: string | null) =>
      ['menus', spaceId, env(spaceId), 'used-in', localizationId] as const,
    placements: (spaceId: string | null, localizationId: string | null, locale: string) =>
      ['menus', spaceId, env(spaceId), 'placements', localizationId, locale] as const,
  },
  redirects: {
    all: (spaceId: string | null) => ['redirects', spaceId] as const,
    page: (spaceId: string | null, params: Params) =>
      ['redirects', spaceId, env(spaceId), 'list', params] as const,
  },
  /** The credential vault, shared by every environment. */
  credentials: {
    all: (spaceId: string | null) => ['credentials', spaceId] as const,
    list: (spaceId: string | null) => ['credentials', spaceId, 'list'] as const,
    page: (spaceId: string | null, params: Params) =>
      ['credentials', spaceId, 'list', params] as const,
  },
  audit: {
    /** Every log of every scope, and the catalogue. */
    root: () => ['audit'] as const,
    all: (spaceId: string | null) => ['audit', spaceId] as const,
    list: (spaceId: string | null, params: Params) => ['audit', spaceId, 'list', params] as const,
    instance: (params: Params) => ['audit', 'instance', params] as const,
    catalog: () => ['audit', 'catalog'] as const,
  },
  notifications: {
    all: () => ['notifications'] as const,
    /** Every inbox list, bell and page. */
    lists: () => ['notifications', 'list'] as const,
    list: (params: { unreadOnly: boolean; limit?: number }) =>
      ['notifications', 'list', params] as const,
    unread: () => ['notifications', 'unread'] as const,
    catalog: () => ['notifications', 'catalog'] as const,
    preferences: () => ['notifications', 'preferences'] as const,
    pushSubscriptions: () => ['notifications', 'push-subscriptions'] as const,
  },
  tags: {
    all: (spaceId: string | null) => ['tags', spaceId] as const,
    list: (spaceId: string | null, search: string) => ['tags', spaceId, 'list', search] as const,
    counts: (spaceId: string | null, search: string) =>
      ['tags', spaceId, 'counts', search] as const,
    /** The tags of the documents on screen, keyed by their ids. */
    ofContent: (spaceId: string | null, contentIds: readonly string[]) =>
      ['tags', spaceId, 'of-content', [...contentIds]] as const,
  },
  assets: {
    all: (spaceId: string | null) => ['assets', spaceId] as const,
    /** The paged library, keyed by the filters that shape it. */
    list: (
      spaceId: string | null,
      filters: {
        search: string;
        mimeType: string | null;
        tagIds: readonly string[];
        mimeTypeNot: readonly string[];
      },
    ) => ['assets', spaceId, 'list', filters] as const,
    byIds: (spaceId: string | null, ids: readonly string[]) =>
      ['assets', spaceId, 'by-id', [...ids]] as const,
    limits: (spaceId: string | null) => ['assets', spaceId, 'limits'] as const,
    presets: (spaceId: string | null) => ['assets', spaceId, 'presets'] as const,
    /** A `filter` asset field's preview, keyed by its settings. */
    relationPreview: (spaceId: string | null, settings: Params) =>
      ['assets', spaceId, 'relation-preview', settings] as const,
  },
};
