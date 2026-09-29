import { localCache } from '@manablox/cache';
import { type ResolvedScope, type Scope, stagingIdOf } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AssetRow, ContentRow, Repositories, SpaceRow, TagRow, UserRow } from '@manablox/db';
import DataLoader from 'dataloader';
import {
  assetRelationQuery,
  contentRelationQuery,
  type RelationQuerySettings,
} from './relation-query.js';

/** Per-request relation batching; per request because they cache. */
export interface Loaders {
  content: DataLoader<string, ContentRow | null>;
  publishedContent: DataLoader<string, ContentRow | null>;
  asset: DataLoader<string, AssetRow | null>;
  user: DataLoader<string, UserRow | null>;
  /** Children keyed by parent id. */
  children: DataLoader<string, ContentRow[]>;
  /** The space row, for its default locale. */
  space: DataLoader<string, SpaceRow | null>;
  /** A document's tags, keyed by localization id. */
  contentTags: DataLoader<string, TagRow[]>;
  /** An asset's tags, keyed by asset id. */
  assetTags: DataLoader<string, TagRow[]>;
  /** A `filter` relation's rows, run once per field and space. */
  relationQuery: DataLoader<RelationQueryKey, RelationQueryResult, string>;
}

export interface RelationQueryKey {
  fieldId: string;
  target: 'content' | 'asset';
  settings: RelationQuerySettings;
  spaceId: string;
  /** The space's production environment when absent. */
  environmentId?: string | undefined;
}

export type RelationQueryResult =
  | { target: 'asset'; items: AssetRow[] }
  | { target: 'content'; items: ContentRow[]; typeIds: string[] | undefined };

export interface LoaderOptions {
  /** Restricts reads to one space; set on the public instance against cross-tenant ids. */
  spaceId?: string | null;
  /**
   * The request's environment. With `spaceId` reads are restricted to it (production when
   * absent); without, a document of its space must be in it and other spaces' in production.
   */
  environment?: ResolvedScope | null;
  /** Requires an asset, listed or by id, to be referenced by a published document. */
  publishedAssetsOnly?: boolean;
  /** Space rows from a process cache (`cachedSpaceRows`) instead of a query per request. */
  spaceRows?: SpaceRows | undefined;
}

/** A space row by id, `null` when there is none. */
export type SpaceRows = (spaceId: string) => Promise<SpaceRow | null>;

/** Space rows kept in process for seconds; any purge of the space's tag drops them everywhere. */
const SPACE_ROW_TTL_MS = 5_000;
const SPACE_ROWS_KEPT = 10_000;
const spaceRowCaches = new WeakMap<Manablox, SpaceRows>();

/** The instance's space rows through a local cache, for per-request readers. */
export function cachedSpaceRows(manablox: Manablox, repos: Repositories): SpaceRows {
  let rows = spaceRowCaches.get(manablox);
  if (!rows) {
    const cache = localCache<SpaceRow | null>(manablox, {
      max: SPACE_ROWS_KEPT,
      ttlMs: SPACE_ROW_TTL_MS,
    });
    rows = (spaceId) =>
      cache.load(spaceId, async () => ({
        value: await repos.spaces.findById(spaceId),
        tags: [`space:${spaceId}`],
      }));
    spaceRowCaches.set(manablox, rows);
  }
  return rows;
}

export function createLoaders(
  repos: Repositories,
  published = false,
  options: LoaderOptions = {},
): Loaders {
  const byId = <T extends { id: string }>(rows: T[], ids: readonly string[]): (T | null)[] => {
    const map = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => map.get(id) ?? null);
  };

  const spaceId = options.spaceId ?? null;
  const environment = options.environment ?? null;
  const scope: Scope | null = spaceId
    ? environment?.spaceId === spaceId
      ? environment
      : spaceId
    : null;

  /** Without a space, rows outside the request's environment and production drop out. */
  const visible = async <T extends ContentRow>(rows: T[]): Promise<T[]> => {
    if (scope || rows.length === 0) return rows;
    const production = new Map<string, boolean>();
    for (const row of rows) {
      if (production.has(row.environmentId)) continue;
      const resolved = await repos.environments.resolve({
        spaceId: row.spaceId,
        environmentId: row.environmentId,
      });
      production.set(row.environmentId, resolved?.production ?? false);
    }
    return rows.filter((row) =>
      environment && row.spaceId === environment.spaceId
        ? row.environmentId === environment.environmentId
        : production.get(row.environmentId),
    );
  };

  // Published in production, or in the request's staging environment.
  const assetStaging = stagingIdOf(environment?.spaceId === spaceId ? environment : null);

  const loadAssets = async (ids: readonly string[]): Promise<(AssetRow | null)[]> => {
    const rows = await repos.assets.listByIds([...ids], spaceId);
    if (!options.publishedAssetsOnly || rows.length === 0) return byId(rows, ids);

    // One query per batch.
    const reachable = await repos.assetUsages.filterPublished(
      rows.map((row) => row.id),
      assetStaging,
    );
    return byId(
      rows.filter((row) => reachable.has(row.id)),
      ids,
    );
  };

  const runRelationQuery = async (key: RelationQueryKey): Promise<RelationQueryResult> => {
    if (key.target === 'asset') {
      const query = assetRelationQuery(key.settings, { spaceId: key.spaceId });
      const page = await repos.assets.page(
        {
          ...query.filter,
          published: options.publishedAssetsOnly,
          ...(assetStaging ? { stagingId: assetStaging } : {}),
        },
        query.pagination,
      );
      return { target: 'asset', items: page.items };
    }
    const query = contentRelationQuery(key.settings, {
      spaceId: key.spaceId,
      environmentId: key.environmentId,
      locale: await defaultLocaleOf(loaders, key.spaceId),
    });
    const page = await repos.content.page(query.filter, query.pagination, query.sorts, published);
    return { target: 'content', items: page.items, typeIds: query.typeIds };
  };

  const loaders: Loaders = {
    content: new DataLoader(async (ids) =>
      byId(await visible(await repos.content.listByIds([...ids], false, scope)), ids),
    ),
    publishedContent: new DataLoader(async (ids) =>
      byId(await visible(await repos.content.listByIds([...ids], true, scope)), ids),
    ),
    asset: new DataLoader(loadAssets),
    user: new DataLoader(async (ids) => byId(await repos.users.listByIds([...ids]), ids)),
    children: new DataLoader(async (parentIds) => {
      const rows = await visible(
        await repos.content.listByParents([...parentIds], published, scope),
      );
      const grouped = new Map<string, ContentRow[]>();
      for (const row of rows) {
        if (!row.parentId) continue;
        const list = grouped.get(row.parentId) ?? [];
        list.push(row);
        grouped.set(row.parentId, list);
      }
      return parentIds.map((id) => grouped.get(id) ?? []);
    }),
    space: new DataLoader(async (ids) => {
      const cached = options.spaceRows;
      if (cached) return Promise.all(ids.map((id) => cached(id)));
      return byId(await repos.spaces.listByIds([...ids]), ids);
    }),
    contentTags: new DataLoader(async (localizationIds) => {
      const grouped = await repos.tags.listByLocalizations([...localizationIds]);
      return localizationIds.map((id) => grouped.get(id) ?? []);
    }),
    assetTags: new DataLoader(async (assetIds) => {
      const grouped = await repos.tags.listByAssets([...assetIds], spaceId);
      return assetIds.map((id) => grouped.get(id) ?? []);
    }),
    relationQuery: new DataLoader((keys) => Promise.all(keys.map(runRelationQuery)), {
      cacheKeyFn: (key) => `${key.target}:${key.spaceId}:${key.environmentId ?? ''}:${key.fieldId}`,
    }),
  };
  return loaders;
}

/** The space's default locale, or `en` for a missing space. */
export async function defaultLocaleOf(loaders: Loaders, spaceId: string): Promise<string> {
  return (await loaders.space.load(spaceId))?.defaultLocale ?? 'en';
}
