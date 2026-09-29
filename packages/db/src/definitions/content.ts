import type { ContentStatus, ResourceSource } from '@manablox/core';
import { sql } from 'drizzle-orm';
import {
  id,
  index,
  integer,
  json,
  path,
  search,
  table,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

/** Shared column set for `contents` and its published projection. */
const contentColumns = {
  id: id(),
  spaceId: uuid()
    .notNull()
    .references(() => spaces, 'id', { onDelete: 'cascade' }),
  environmentId: environmentId(),
  typeId: uuid().notNull(),
  locale: text().notNull(),
  /** Shared by all translations of one logical document. */
  localizationId: uuid().notNull(),
  parentId: uuid(),
  title: text().notNull(),
  slug: text().notNull(),
  /** Materialised ancestor path, root first, ending in this node's own id. */
  path: path().notNull(),
  /** Routable URL path; NULL for a slug-less (structural) node. */
  permalink: text(),
  /** Ancestor segments plus this node's, slug-less levels skipped; descendants derive from it. */
  permalinkPath: text().notNull().default(''),
  /** This node's slug for descendant permalinks, or NULL; denormalised so no registry is needed. */
  permalinkSegment: text(),
  status: text<ContentStatus>().notNull().default('draft'),
  position: integer().notNull().default(0),
  fields: json<Record<string, unknown>>().notNull().default({}),
  /** Concatenated output of each field type's `search()`. */
  searchText: text().notNull().default(''),
  /** Optimistic-lock counter; a write with a stale version is rejected. */
  version: integer().notNull().default(1),
  /** `code` on a document a `managed` template owns: rewritten by sync, read-only elsewhere. */
  source: text<ResourceSource>().notNull().default('runtime'),
  sourceRef: text(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
  createdBy: uuid(),
  updatedBy: uuid(),
  publishedAt: timestamp(),
  /** Schedule window. Publishing clears `publishAt`; it is always null in the projection. */
  publishAt: timestamp(),
  unpublishAt: timestamp(),
};

export const contents = table(
  'contents',
  {
    ...contentColumns,
    search: search(),
  },
  (t) => [
    // Postgres walks the tree with gist; SQLite with a btree range.
    index('contents_path_gist_idx').using('gist', t.path),
    index('contents_path_idx').on(t.path).only('sqlite'),
    index('contents_parent_idx').on(t.parentId),
    index('contents_space_type_idx').on(t.spaceId, t.typeId),
    index('contents_localization_idx').on(t.localizationId),
    index('contents_status_idx').on(t.spaceId, t.status),
    // Lists in their default order read a page off this instead of sorting every match.
    index('contents_list_idx').on(t.environmentId, t.position, t.createdAt, t.id),
    index('contents_fields_gin_idx').using('gin', sql`${t.fields} jsonb_path_ops`),
    index('contents_search_gin_idx').using('gin', t.search),
    // NULLS NOT DISTINCT, or root rows (`parent_id IS NULL`) never collide.
    unique('contents_sibling_slug_key')
      .on(t.environmentId, t.parentId, t.locale, t.slug)
      .nullsNotDistinct(),
    uniqueIndex('contents_permalink_key')
      .on(t.environmentId, t.locale, t.permalink)
      .where(sql`permalink is not null`),
    // Partial indexes for the scheduler's `is not null and <= now()` queries.
    index('contents_publish_at_idx').on(t.publishAt).where(sql`publish_at is not null`),
    index('contents_unpublish_at_idx').on(t.unpublishAt).where(sql`unpublish_at is not null`),
  ],
);

/** Delivery projection, written on publish and read by the public API. */
export const publishedContents = table(
  'published_contents',
  {
    ...contentColumns,
    /** Version of `contents` this projection was made from. */
    sourceVersion: integer().notNull().default(1),
    search: search(),
  },
  (t) => [
    index('published_contents_path_gist_idx').using('gist', t.path),
    index('published_contents_path_idx').on(t.path).only('sqlite'),
    index('published_contents_parent_idx').on(t.parentId),
    index('published_contents_space_type_idx').on(t.spaceId, t.typeId),
    // Translations of a document (alternates, `inLocale`) on every site render.
    index('published_contents_localization_idx').on(t.localizationId),
    // Delivery lists (always one locale) in their default order, see `contents_list_idx`.
    index('published_contents_list_idx').on(
      t.environmentId,
      t.locale,
      t.position,
      t.createdAt,
      t.id,
    ),
    index('published_contents_fields_gin_idx').using('gin', sql`${t.fields} jsonb_path_ops`),
    index('published_contents_search_gin_idx').using('gin', t.search),
    uniqueIndex('published_contents_permalink_key')
      .on(t.environmentId, t.locale, t.permalink)
      .where(sql`permalink is not null`),
  ],
);

/** Full snapshot per save, so any edit can be rolled back. */
export const contentVersions = table(
  'content_versions',
  {
    id: id(),
    contentId: uuid().notNull(),
    version: integer().notNull(),
    label: text(),
    snapshot: json<Record<string, unknown>>().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [
    uniqueIndex('content_versions_content_version_key').on(t.contentId, t.version),
    index('content_versions_content_idx').on(t.contentId, t.createdAt),
    index('content_versions_created_idx').on(t.createdAt),
  ],
);
