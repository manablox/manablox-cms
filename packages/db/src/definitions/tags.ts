import { assets } from './assets.js';
import { id, index, primaryKey, table, text, timestamp, uniqueIndex, uuid } from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

/** A space's tag vocabulary; editors add to it as they type. */
export const tags = table(
  'tags',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    name: text().notNull(),
    /** Slugified `name`; the identity two spellings of one tag collapse onto. */
    slug: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [
    uniqueIndex('tags_space_slug_key').on(t.spaceId, t.slug),
    index('tags_space_name_idx').on(t.spaceId, t.name),
  ],
);

/**
 * Tags of a document, held per localization group: every translation carries the same ones.
 * No foreign key on `localization_id`, which no table keys; the content service prunes it.
 */
export const contentTags = table(
  'content_tags',
  {
    tagId: uuid()
      .notNull()
      .references(() => tags, 'id', { onDelete: 'cascade' }),
    localizationId: uuid().notNull(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    primaryKey(t.tagId, t.localizationId),
    // The editor and the list read a document's tags by group.
    index('content_tags_localization_idx').on(t.localizationId),
    index('content_tags_space_idx').on(t.spaceId),
  ],
);

/** Tags of an asset; the tag's space decides who sees it. */
export const assetTags = table(
  'asset_tags',
  {
    tagId: uuid()
      .notNull()
      .references(() => tags, 'id', { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      .references(() => assets, 'id', { onDelete: 'cascade' }),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [primaryKey(t.tagId, t.assetId), index('asset_tags_asset_idx').on(t.assetId)],
);
