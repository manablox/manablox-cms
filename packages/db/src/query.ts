import { type ContentTypeRegistry, type FilterOperator, ManabloxError } from '@manablox/core';
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { type Dialect, escapeLike } from './dialect.js';
import type { KeysetColumn } from './pagination.js';
import type { Tables } from './tables.js';

/** Typed as the union, not `PgTable`, so Drizzle keeps real column references. */
export type ContentTable = Tables['contents'] | Tables['publishedContents'];

/** `?: T | undefined` accepts the explicit `undefined` validators produce. */
export interface FieldFilter {
  /** Field machine name on the content type. */
  name: string;
  op: FilterOperator;
  value?: unknown | undefined;
}

export interface ContentFilter {
  spaceId?: string | undefined;
  /** With `spaceId` absent too, every production environment. */
  environmentId?: string | undefined;
  /** Content type ids. */
  typeIds?: string[] | undefined;
  locale?: string | undefined;
  status?: 'draft' | 'published' | 'archived' | undefined;
  ids?: string[] | undefined;
  parentId?: string | null | undefined;
  /** Restrict to the subtree below this content id. */
  under?: string | undefined;
  slug?: string | undefined;
  permalink?: string | undefined;
  localizationId?: string | undefined;
  /** Full-text query against `title` + field contributions; also matches tag names. */
  search?: string | undefined;
  /** Like `search`, but a part of the title matches too, for search as you type. */
  typeahead?: string | undefined;
  /** Tag ids; a document matching any of them is kept. */
  tagIds?: string[] | undefined;
  /** Tag slugs, for callers that name tags rather than hold their ids. */
  tagSlugs?: string[] | undefined;
  fields?: FieldFilter[] | undefined;
}

export interface ContentSort {
  by: 'position' | 'title' | 'createdAt' | 'updatedAt' | 'publishedAt' | 'slug';
  direction: 'asc' | 'desc';
}

export interface Pagination {
  limit: number;
  offset: number;
}

const SORT_COLUMNS: Record<ContentSort['by'], string> = {
  position: 'position',
  title: 'title',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
  slug: 'slug',
};

/** A filter as SQL; field operators must be declared by the field type's `filters`. */
export function buildContentWhere(
  dialect: Dialect,
  table: ContentTable,
  filter: ContentFilter,
  registry: ContentTypeRegistry,
): SQL | undefined {
  const conditions: SQL[] = [];

  if (filter.spaceId) conditions.push(eq(table.spaceId, filter.spaceId));
  conditions.push(environmentCondition(dialect, table, filter));
  if (filter.locale) conditions.push(eq(table.locale, filter.locale));
  if (filter.status) conditions.push(eq(table.status, filter.status));
  if (filter.localizationId) conditions.push(eq(table.localizationId, filter.localizationId));
  if (filter.slug) conditions.push(eq(table.slug, filter.slug));
  if (filter.permalink !== undefined) conditions.push(eq(table.permalink, filter.permalink));
  if (filter.typeIds?.length) conditions.push(inArray(table.typeId, filter.typeIds));
  if (filter.ids?.length) conditions.push(inArray(table.id, filter.ids));

  if (filter.parentId !== undefined) {
    conditions.push(
      filter.parentId === null ? isNull(table.parentId) : eq(table.parentId, filter.parentId),
    );
  }

  if (filter.under) {
    const root = sql`(select path from ${table} where id = ${dialect.param(filter.under, 'uuid')})`;
    conditions.push(dialect.pathWithin(table.path, root));
  }

  if (filter.search) {
    // Tags are part of what a document is called, so free text finds them too.
    conditions.push(
      or(
        dialect.search(table, filter.search),
        contentTagText(dialect, table, filter.search),
      ) as SQL,
    );
  }
  if (filter.typeahead) {
    conditions.push(
      or(
        dialect.search(table, filter.typeahead),
        dialect.ilike(table.title, `%${escapeLike(filter.typeahead)}%`),
        contentTagText(dialect, table, filter.typeahead),
      ) as SQL,
    );
  }
  if (filter.tagIds?.length) {
    conditions.push(contentTagMatch(table, tagIdList(dialect, filter.tagIds)));
  }
  if (filter.tagSlugs?.length) {
    conditions.push(contentTagMatch(table, tagSlugList(dialect, filter.tagSlugs)));
  }

  for (const fieldFilter of filter.fields ?? []) {
    assertOperatorAllowed(fieldFilter, filter.typeIds ?? [], registry);
    conditions.push(dialect.fieldCondition(table.fields, fieldFilter));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** The filter's environment; the space's production one, or every production one. */
function environmentCondition(dialect: Dialect, table: ContentTable, filter: ContentFilter): SQL {
  if (filter.environmentId) return eq(table.environmentId, filter.environmentId);
  const space = filter.spaceId
    ? sql` and space_id = ${dialect.param(filter.spaceId, 'uuid')}`
    : sql``;
  const operator = filter.spaceId ? sql`=` : sql`in`;
  return sql`${table.environmentId} ${operator} (select id from space_environments where kind = 'production'${space})`;
}

/** Whether the document's localization group carries a tag `condition` accepts. */
function contentTagMatch(table: ContentTable, condition: SQL): SQL {
  return sql`exists (
    select 1 from content_tags ct
    inner join tags tg on tg.id = ct.tag_id
    where ct.localization_id = ${table.localizationId} and ${condition}
  )`;
}

const tagIdList = (dialect: Dialect, ids: string[]): SQL =>
  sql`ct.tag_id in (${sql.join(
    ids.map((id) => dialect.param(id, 'uuid')),
    sql`, `,
  )})`;

const tagSlugList = (dialect: Dialect, slugs: string[]): SQL =>
  sql`tg.slug in (${sql.join(
    slugs.map((slug) => dialect.param(slug, 'text')),
    sql`, `,
  )})`;

/** A free-text term against the tag names of the document's group. */
const contentTagText = (dialect: Dialect, table: ContentTable, term: string): SQL =>
  contentTagMatch(table, dialect.ilike(sql`tg.name`, `%${escapeLike(term)}%`));

/** Accepted only if every candidate content type has that field and supports the operator. */
function assertOperatorAllowed(
  filter: FieldFilter,
  typeIds: string[],
  registry: ContentTypeRegistry,
): void {
  const candidates =
    typeIds.length > 0 ? typeIds.map((id) => registry.get(id)) : registry.contentTypes;

  const matching = candidates
    .map((type) => type.fields.find((field) => field.name === filter.name))
    .filter((field): field is NonNullable<typeof field> => field !== undefined);

  if (matching.length === 0) {
    throw ManabloxError.badRequest('query.field.unknown', { field: filter.name });
  }

  for (const field of matching) {
    const fieldType = registry.fieldTypes.tryGet(field.type);
    if (!fieldType?.filters.includes(filter.op)) {
      throw ManabloxError.badRequest('query.operator.unsupported', {
        field: filter.name,
        fieldType: field.type,
        op: filter.op,
      });
    }
  }
}

/** Sorts a keyset walk accepts: not-null columns, see `keysetOrder`. */
const KEYSET_COLUMNS = {
  position: 'position',
  title: 'title',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  slug: 'slug',
} as const;

/** The sort as keyset columns (`keysetBatches`), `position, created_at` by default. */
export function keysetOrder(table: ContentTable, sorts: ContentSort[]): KeysetColumn[] {
  if (sorts.length === 0) return [{ column: table.position }, { column: table.createdAt }];
  return sorts.map((sort) => {
    const key = KEYSET_COLUMNS[sort.by as keyof typeof KEYSET_COLUMNS];
    if (!key) throw ManabloxError.badRequest('query.sort.unsupported', { by: sort.by });
    return { column: table[key], desc: sort.direction === 'desc' };
  });
}

/** The sort as SQL, `position, created_at` by default; `paginate` appends `id` to either. */
export function buildOrderBy(sorts: ContentSort[]): SQL {
  if (sorts.length === 0) {
    return sql`${sql.identifier('position')} asc, ${sql.identifier('created_at')} asc`;
  }
  const parts = sorts.map((sort) => {
    const column = SORT_COLUMNS[sort.by];
    if (!column) throw ManabloxError.badRequest('query.sort.unsupported', { by: sort.by });
    return sql`${sql.identifier(column)} ${sql.raw(sort.direction === 'desc' ? 'desc' : 'asc')}`;
  });
  return parts.reduce((acc, part) => sql`${acc}, ${part}`);
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw ManabloxError.badRequest('query.value.expectedArray');
  return value.map((entry) => String(entry));
}

export function asNumber(value: unknown): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw ManabloxError.badRequest('query.value.expectedNumber');
  return parsed;
}
