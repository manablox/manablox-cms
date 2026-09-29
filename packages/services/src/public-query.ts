import { type ContentTypeRegistry, ManabloxError, type ResolvedScope } from '@manablox/core';
import type { ContentFilter, ContentSort, Pagination } from '@manablox/db';

/** Public list arguments, for GraphQL and REST. */
export interface PublicListArgs {
  type?: string | null | undefined;
  locale?: string | null | undefined;
  parentId?: string | null | undefined;
  under?: string | null | undefined;
  search?: string | null | undefined;
  /** Comma-separated tag slugs; a document carrying any of them matches. */
  tags?: string | null | undefined;
  limit?: number | null | undefined;
  offset?: number | null | undefined;
}

export interface PublicQueryDefaults {
  spaceId: string;
  /** The request's environment; production when absent. */
  scope?: ResolvedScope | null | undefined;
  locale: string;
}

export interface PublicQuery {
  filter: ContentFilter;
  pagination: Pagination;
  sorts: ContentSort[];
  /** Resolved from `args.type`, for cache tags. */
  typeIds: string[] | undefined;
}

export const PUBLIC_LIST_DEFAULT_LIMIT = 25;
/** The largest page either delivery surface serves. */
export const PUBLIC_LIST_MAX_LIMIT = 100;

/** `a, b,,c` as `['a', 'b', 'c']`; at most ten, so the query stays bounded. */
export function parseTagSlugs(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((slug) => slug.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 10);
}

/** Public list arguments as a repository query, shared by GraphQL and REST. */
export function toPublicListQuery(
  registry: ContentTypeRegistry,
  args: PublicListArgs,
  defaults: PublicQueryDefaults,
): PublicQuery {
  const typeIds = args.type
    ? [registry.getByName(args.type, defaults.scope ?? defaults.spaceId).id]
    : undefined;
  const tagSlugs = parseTagSlugs(args.tags);
  const limit = args.limit ?? PUBLIC_LIST_DEFAULT_LIMIT;
  const offset = args.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > PUBLIC_LIST_MAX_LIMIT) {
    throw ManabloxError.badRequest('query.limit.invalid', { limit, max: PUBLIC_LIST_MAX_LIMIT });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw ManabloxError.badRequest('query.offset.invalid', { offset });
  }

  return {
    filter: {
      spaceId: defaults.spaceId,
      ...(defaults.scope ? { environmentId: defaults.scope.environmentId } : {}),
      locale: args.locale ?? defaults.locale,
      ...(typeIds ? { typeIds } : {}),
      ...(args.parentId ? { parentId: args.parentId } : {}),
      ...(args.under ? { under: args.under } : {}),
      ...(args.search ? { search: args.search } : {}),
      ...(tagSlugs.length ? { tagSlugs } : {}),
    },
    pagination: { limit, offset },
    sorts: [],
    typeIds,
  };
}
