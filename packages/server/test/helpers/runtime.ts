import { Readable } from 'node:stream';
import { attachCache, createCache } from '@manablox/cache';
import { type ManabloxConfig, ManabloxError } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { fixedId, ids } from '@manablox/core/testing';
import { builtinFieldTypes } from '@manablox/fields';
import type { Runtime } from '../../src/bootstrap.js';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

/** Every stubbed asset's stored bytes. */
export const ASSET_BYTES = 'image-bytes';

/** The production environment id of a stubbed space. */
const productionOf = (spaceId: string): string => `${spaceId.slice(0, -4)}e0e0`;

/** A stubbed space's production scope. */
const productionScope = (spaceId: string) => ({
  spaceId,
  environmentId: productionOf(spaceId),
  machineName: 'production',
  production: true,
});

/** Referenced only by an unpublished draft. */
export const DRAFT_ASSET_ID = fixedId(101);
export const OTHER_SPACE_ASSET_ID = fixedId(102);
/** Published, but its window has not opened. */
export const FUTURE_ASSET_ID = fixedId(103);
/** Published, but its window has closed. */
export const EXPIRED_ASSET_ID = fixedId(104);

export interface StubCalls {
  /** `(ids, published, spaceId)` per content loader call. */
  listByIds: Array<[string[], boolean, string | null | undefined]>;
  listFilters: Array<Record<string, unknown>>;
  menuLookups: Array<[string, string, boolean]>;
  /** Principal resolutions; must stay 0 on public. */
  principalLookups: number;
  /** `findByPermalink` arguments; `''` is the home page. */
  permalinks: string[];
  /** Every stubbed database round trip. */
  queries: string[];
  /** Spaces whose import has not finished; add to hide one. */
  importing: Set<string>;
  /** API host names and their spaces; add to serve a space by host. */
  apiHosts: Map<string, string>;
}

/** A runtime with no database, for fast `createApp` tests. */
export function stubRuntime(config: Partial<ManabloxConfig> = {}): {
  runtime: Runtime;
  calls: StubCalls;
  manablox: Manablox;
} {
  const calls: StubCalls = {
    listByIds: [],
    listFilters: [],
    menuLookups: [],
    principalLookups: 0,
    permalinks: [],
    queries: [],
    importing: new Set(),
    apiHosts: new Map(),
  };

  const manablox = new Manablox({
    database: { url: 'postgres://unused' },
    auth: { secret: 'test-secret' },
    fieldTypes: builtinFieldTypes,
    logLevel: 'silent',
    contentTypes: [
      {
        name: 'page',
        fields: [
          { name: 'summary', type: 'string' },
          { name: 'hero', type: 'asset' },
          { name: 'author', type: 'user' },
          { name: 'internal_note', type: 'string', readRoles: ['admin'] },
        ],
      },
    ],
    ...config,
  } as ManabloxConfig);

  const row = (id: string, spaceId: string) => ({
    id,
    spaceId,
    environmentId: productionOf(spaceId),
    typeId: manablox.contentTypes.getByName('page').id,
    locale: 'en',
    title: 'Pinned',
    slug: 'pinned',
    permalink: 'pinned',
    parentId: null,
    status: 'published',
    fields: { summary: 'from the pinned space', hero: ids.asset, author: ids.author },
    visibleInMenu: true,
    position: 0,
    version: 1,
    // Fixed so ETags are stable across requests.
    publishedAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    createdAt: FIXED_DATE,
  });

  const ASSET_SPACES: Record<string, string> = {
    [ids.asset]: ids.space,
    [DRAFT_ASSET_ID]: ids.space,
    [OTHER_SPACE_ASSET_ID]: ids.otherSpace,
    [FUTURE_ASSET_ID]: ids.space,
    [EXPIRED_ASSET_ID]: ids.space,
  };

  /** A day either side, so a slow suite cannot cross a boundary. */
  const ASSET_WINDOWS: Record<string, { publishAt: Date | null; unpublishAt: Date | null }> = {
    [FUTURE_ASSET_ID]: { publishAt: new Date(Date.now() + 86_400_000), unpublishAt: null },
    [EXPIRED_ASSET_ID]: { publishAt: null, unpublishAt: new Date(Date.now() - 86_400_000) },
  };

  /** The one tag every stubbed document and asset carries. */
  const tagRow = () => ({
    id: ids.tag,
    spaceId: ids.space,
    name: 'Featured',
    slug: 'featured',
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    createdBy: null,
  });

  const assetRow = (id: string) => {
    const spaceId = ASSET_SPACES[id];
    if (!spaceId) return null;
    return {
      id,
      spaceId,
      filename: 'hero.jpg',
      name: 'hero',
      mimeType: 'image/jpeg',
      size: ASSET_BYTES.length,
      checksum: `sum-${id}`,
      key: `k/${id}`,
      driver: 'local',
      width: 800,
      height: 600,
      alt: 'A hero',
      title: null,
      publishAt: ASSET_WINDOWS[id]?.publishAt ?? null,
      unpublishAt: ASSET_WINDOWS[id]?.unpublishAt ?? null,
    };
  };

  const spaces = [
    {
      id: ids.space,
      machineName: 'pinned',
      name: 'Pinned',
      url: 'https://example.test',
      defaultLocale: 'en',
    },
    {
      id: ids.otherSpace,
      machineName: 'other',
      name: 'Other',
      url: 'https://other.test',
      defaultLocale: 'en',
    },
  ];

  const repos = {
    spaces: {
      list: async () => spaces,
      findById: async (id: string) => spaces.find((space) => space.id === id) ?? null,
      listByIds: async (wanted: string[]) => {
        calls.queries.push('spaces.listByIds');
        return spaces.filter((space) => wanted.includes(space.id));
      },
      findByMachineName: async (name: string) =>
        spaces.find((space) => space.machineName === name) ?? null,
    },

    environments: {
      resolve: async (scope: string | { spaceId: string }) =>
        productionScope(typeof scope === 'string' ? scope : scope.spaceId),
    },

    content: {
      listByIds: async (
        wanted: string[],
        published: boolean,
        scope?: string | { spaceId: string } | null,
      ) => {
        const spaceId = typeof scope === 'object' && scope ? scope.spaceId : scope;
        calls.listByIds.push([wanted, published, spaceId]);
        calls.queries.push('content.listByIds');
        return wanted
          .map((id) => row(id, id.startsWith('2') ? ids.otherSpace : ids.space))
          .filter((r) => !spaceId || r.spaceId === spaceId);
      },
      listByParents: async () => [],
      findByPermalink: async (
        scope: string | { spaceId: string },
        _locale: string,
        permalink: string,
      ) => {
        calls.queries.push('content.findByPermalink');
        calls.permalinks.push(permalink);
        return row('c1', typeof scope === 'string' ? scope : scope.spaceId);
      },
      page: async (
        filter: Record<string, unknown>,
        pagination: { limit: number; offset: number } = { limit: 25, offset: 0 },
      ) => {
        calls.listFilters.push(filter);
        calls.queries.push('content.page');
        const items = Array.from({ length: Math.min(pagination.limit, 50) }, (_, i) =>
          row(`c${i}`, String(filter.spaceId)),
        );
        return { items, total: items.length, limit: pagination.limit, offset: pagination.offset };
      },
    },

    assets: {
      listByIds: async (wanted: string[], spaceId?: string | null) => {
        calls.queries.push('assets.listByIds');
        return wanted
          .map((id) => assetRow(id))
          .filter((asset): asset is NonNullable<typeof asset> => asset !== null)
          .filter((asset) => !spaceId || asset.spaceId === spaceId);
      },
      findById: async (id: string, spaceId?: string | null) => {
        const asset = assetRow(id);
        return !spaceId || asset?.spaceId === spaceId ? asset : null;
      },
      page: async (_filter: unknown, pagination: { limit: number; offset: number }) => {
        calls.queries.push('assets.page');
        const items = [assetRow(ids.asset)];
        return { items, total: 1, limit: pagination.limit, offset: pagination.offset };
      },
    },

    assetUsages: {
      // DRAFT_ASSET_ID is only used by an unpublished draft.
      filterPublished: async (wanted: string[]) => {
        calls.queries.push('assetUsages.filterPublished');
        return new Set(
          wanted.filter(
            (id) => id === ids.asset || id === FUTURE_ASSET_ID || id === EXPIRED_ASSET_ID,
          ),
        );
      },
    },

    users: {
      listByIds: async (wanted: string[]) => {
        calls.queries.push('users.listByIds');
        return wanted.map((id) => ({ id, name: 'Ada', image: null }));
      },
    },

    tags: {
      listByLocalizations: async (localizationIds: string[]) => {
        calls.queries.push('tags.listByLocalizations');
        // One tag on every document, so payloads carry the shape delivery promises.
        return new Map(localizationIds.map((id) => [id, [tagRow()]]));
      },
      listByAssets: async (assetIds: string[]) => {
        calls.queries.push('tags.listByAssets');
        return new Map(assetIds.map((id) => [id, [tagRow()]]));
      },
    },
  };

  // As `bootstrap()` does: no shared cache with the cache off.
  const cache = manablox.config.cache.enabled
    ? memoryCache()
    : createCache({ enabled: false, ttl: manablox.config.cache.ttl });

  const runtime = {
    mode: manablox.config.server.mode,
    manablox,
    handle: { db: { execute: async () => [] }, close: async () => {} },
    repos,
    auth: {
      handler: () => new Response('auth'),
      api: {
        getSession: async () => {
          calls.principalLookups++;
          return null;
        },
      },
    },
    apiKeys: {
      resolve: async () => {
        calls.principalLookups++;
        return null;
      },
    },
    media: {
      urlFor: () => 'https://cdn.test/x',
      verify: () => true,
      derive: async () => ({ body: Buffer.from('img'), contentType: 'image/webp' }),
    },
    content: {},
    contentTypes: {},
    spaces: {
      isReady: async (id: string) =>
        spaces.some((space) => space.id === id) && !calls.importing.has(id),
    },
    environments: {
      scope: async (spaceId: string) => productionScope(spaceId),
      resolve: async (scope: { spaceId: string }) => productionScope(scope.spaceId),
      forRequest: async (spaceId: string, machineName?: string | null) => {
        if (machineName && machineName !== 'production') {
          throw ManabloxError.notFound('environment.notFound', { spaceId, machineName });
        }
        return productionScope(spaceId);
      },
      admit: async () => {},
    },
    menus: {
      resolve: async (
        scope: string | { spaceId: string },
        name: string,
        locale: string,
        published: boolean,
      ) => {
        const spaceId = typeof scope === 'string' ? scope : scope.spaceId;
        calls.queries.push('menus.resolve');
        calls.menuLookups.push([name, locale, published]);
        if (name !== 'main') return null;
        return {
          id: 'm1',
          name: 'Main',
          machineName: 'main',
          items: [
            {
              id: 'i1',
              label: 'Home',
              url: null,
              target: '_self',
              content: row('c1', spaceId),
              children: [
                {
                  id: 'i2',
                  label: 'Team',
                  url: null,
                  target: '_self',
                  content: row('c2', spaceId),
                  children: [],
                },
              ],
            },
            {
              id: 'i3',
              label: 'Blog',
              url: 'https://blog.example.test',
              target: '_blank',
              content: null,
              children: [],
            },
          ],
        };
      },
    },
    cache,
    apiHosts: {
      resolve: async (host: string) => {
        const spaceId = calls.apiHosts.get(host.replace(/:\d+$/, ''));
        return spaceId ? { spaceId, environmentId: productionOf(spaceId) } : null;
      },
      any: async () => calls.apiHosts.size > 0,
    },
    storage: {
      get: async () => Buffer.from(ASSET_BYTES),
      stream: async (_key: string, range?: { start: number; end: number }) =>
        Readable.from([
          Buffer.from(range ? ASSET_BYTES.slice(range.start, range.end + 1) : ASSET_BYTES),
        ]),
    },
    jobs: {},
    shutdown: async () => {},
  } as unknown as Runtime;

  return { runtime, calls, manablox };
}

/** A minimal tag-indexed cache mirroring `MemoryCache`. */
export function memoryCache() {
  const entries = new Map<string, unknown>();
  const tags = new Map<string, Set<string>>();

  return {
    entries,
    tags,
    async get<T>(key: string): Promise<T | null> {
      return (entries.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T, options: { tags?: string[] } = {}): Promise<void> {
      entries.set(key, value);
      for (const tag of options.tags ?? []) {
        const set = tags.get(tag) ?? new Set<string>();
        set.add(key);
        tags.set(tag, set);
      }
    },
    async purge(purgeTags: string[]): Promise<number> {
      let purged = 0;
      for (const tag of purgeTags) {
        for (const key of tags.get(tag) ?? []) {
          if (entries.delete(key)) purged++;
        }
        tags.delete(tag);
      }
      return purged;
    },
    async clear(): Promise<void> {
      entries.clear();
      tags.clear();
    },
    async close(): Promise<void> {},
  };
}

export async function initialised(runtime: Runtime): Promise<Runtime> {
  await runtime.manablox.init();
  // As `bootstrap()` does, so cache tests exercise the purge hook.
  attachCache(runtime.manablox, runtime.cache);
  return runtime;
}
