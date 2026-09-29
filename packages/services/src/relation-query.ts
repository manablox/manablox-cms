import type { AssetFilter, ContentFilter, ContentSort, Pagination } from '@manablox/db';

/**
 * Maps a query-configured relation field to a repository query, shared by every
 * transport. Settings are read leniently since the stored JSONB may be of any shape.
 */
export interface RelationQuerySettings {
  multiple?: unknown;
  selection?: unknown;
  limit?: unknown;
  offset?: unknown;
  search?: unknown;
  types?: unknown;
  under?: unknown;
  sortBy?: unknown;
  sortDirection?: unknown;
  accept?: unknown;
}

/** The default page size, matching the field type's own schema. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Mirrors `isFilterRelation` in `@manablox/fields`, without the dependency. */
export function isFilterRelation(settings: RelationQuerySettings): boolean {
  return settings.multiple === true && settings.selection === 'filter';
}

export interface ContentRelationQuery {
  filter: ContentFilter;
  pagination: Pagination;
  sorts: ContentSort[];
  /** The types the query is pinned to, for cache tags. */
  typeIds: string[] | undefined;
}

export function contentRelationQuery(
  settings: RelationQuerySettings,
  context: { spaceId: string; environmentId?: string | undefined; locale: string },
): ContentRelationQuery {
  const typeIds = stringList(settings.types);
  const search = trimmed(settings.search);
  const under = trimmed(settings.under);

  return {
    filter: {
      spaceId: context.spaceId,
      ...(context.environmentId ? { environmentId: context.environmentId } : {}),
      locale: context.locale,
      ...(typeIds.length ? { typeIds } : {}),
      ...(under ? { under } : {}),
      ...(search ? { search } : {}),
    },
    pagination: pagination(settings),
    sorts: [
      {
        by: sortBy(settings.sortBy),
        direction: settings.sortDirection === 'desc' ? 'desc' : 'asc',
      },
    ],
    typeIds: typeIds.length ? typeIds : undefined,
  };
}

export interface AssetRelationQuery {
  filter: AssetFilter;
  pagination: Pagination;
}

/** The repository takes one mime prefix, so the first is used. */
export function assetRelationQuery(
  settings: RelationQuerySettings,
  context: { spaceId: string },
): AssetRelationQuery {
  const accept = stringList(settings.accept);
  const search = trimmed(settings.search);

  return {
    filter: {
      spaceId: context.spaceId,
      ...(accept[0] ? { mimeType: accept[0] } : {}),
      ...(search ? { search } : {}),
    },
    pagination: pagination(settings),
  };
}

const SORT_KEYS = ['position', 'title', 'createdAt', 'updatedAt', 'publishedAt', 'slug'] as const;

function sortBy(value: unknown): ContentSort['by'] {
  return (SORT_KEYS as readonly string[]).includes(value as string)
    ? (value as ContentSort['by'])
    : 'position';
}

function pagination(settings: RelationQuerySettings): Pagination {
  const limit = Number(settings.limit);
  const offset = Number(settings.offset);
  return {
    limit: Number.isFinite(limit)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
      : DEFAULT_LIMIT,
    offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
