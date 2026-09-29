import { sql } from 'drizzle-orm';
import { contents } from './content.js';
import {
  boolean,
  id,
  index,
  integer,
  json,
  primaryKey,
  table,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

export const assets = table(
  'assets',
  {
    id: id(),
    // Spaces live in `asset_spaces`.
    driver: text().notNull().default('local'),
    /** Storage-relative key, e.g. `<space>/2026/09/photo.jpg`. */
    key: text().notNull(),
    filename: text().notNull(),
    name: text().notNull(),
    mimeType: text().notNull(),
    size: integer().notNull(),
    width: integer(),
    height: integer(),
    /** Seconds, for audio/video. */
    duration: integer(),
    /** SHA-256 of the bytes, for dedupe. */
    checksum: text(),
    alt: text(),
    title: text(),
    /** Availability window the media route enforces at request time. */
    publishAt: timestamp(),
    unpublishAt: timestamp(),
    meta: json<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [
    uniqueIndex('assets_driver_key_key').on(t.driver, t.key),
    index('assets_created_idx').on(t.createdAt),
    index('assets_checksum_idx').on(t.checksum),
    // For the admin's "scheduled" filter.
    index('assets_schedule_idx')
      .on(t.publishAt, t.unpublishAt)
      .where(sql`publish_at is not null or unpublish_at is not null`),
  ],
);

/** The spaces an asset appears in; removing the last row deletes the asset. */
export const assetSpaces = table(
  'asset_spaces',
  {
    assetId: uuid()
      .notNull()
      .references(() => assets, 'id', { onDelete: 'cascade' }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey(t.assetId, t.spaceId),
    // The library lists by space.
    index('asset_spaces_space_idx').on(t.spaceId, t.assetId),
  ],
);

export const assetVariants = table(
  'asset_variants',
  {
    id: id(),
    assetId: uuid()
      .notNull()
      .references(() => assets, 'id', { onDelete: 'cascade' }),
    preset: text().notNull(),
    format: text().notNull(),
    key: text().notNull(),
    width: integer(),
    height: integer(),
    size: integer().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('asset_variants_asset_preset_format_key').on(t.assetId, t.preset, t.format)],
);

/** Which documents reference which assets; gates public asset access on `published`. */
export const assetUsages = table(
  'asset_usages',
  {
    assetId: uuid()
      .notNull()
      .references(() => assets, 'id', { onDelete: 'cascade' }),
    contentId: uuid()
      .notNull()
      .references(() => contents, 'id', { onDelete: 'cascade' }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    /** True when the published projection references the asset. */
    published: boolean().notNull().default(false),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey(t.assetId, t.contentId),
    // Index-only scan for the public `asset_id = any($1) and published` check.
    index('asset_usages_published_idx').on(t.assetId, t.published),
    index('asset_usages_content_idx').on(t.contentId),
    index('asset_usages_space_idx').on(t.spaceId),
  ],
);
