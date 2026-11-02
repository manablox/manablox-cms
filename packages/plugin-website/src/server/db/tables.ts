import type { ResourceSource } from '@manablox/core';
import {
  boolean,
  environmentId,
  hostVerification,
  id,
  index,
  integer,
  json,
  spaces,
  table,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from '@manablox/db/definitions';
import type { SiteDesignKindName } from '../../shared/site.js';

/**
 * A stored design of a designed site; a design without a row is generated at render time.
 * `key` names what it styles: `default` for theme and site, a type id for block and page,
 * a machine name for layout and menu.
 */
export const websiteDesigns = table(
  'website_designs',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    kind: text<SiteDesignKindName>().notNull(),
    key: text().notNull(),
    name: text().notNull().default(''),
    draft: json<unknown>().notNull(),
    /** Null until first published. */
    published: json<unknown>(),
    /** Optimistic lock, bumped by every draft save. */
    version: integer().notNull().default(1),
    /** `version` the live copy was made from; the draft is dirty while they differ. */
    publishedVersion: integer(),
    publishedAt: timestamp(),
    publishedBy: uuid(),
    /** `code` rows are reconciled from the config and plugins. */
    source: text<ResourceSource>().notNull().default('runtime'),
    sourceRef: text(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
    createdBy: uuid(),
    updatedBy: uuid(),
  },
  (t) => [unique('website_designs_environment_kind_key_key').on(t.environmentId, t.kind, t.key)],
);

/** A snapshot per publish or save point; restore copies one into the draft. */
export const websiteDesignVersions = table(
  'website_design_versions',
  {
    id: id(),
    designId: uuid()
      .notNull()
      .references(() => websiteDesigns, 'id', { onDelete: 'cascade' }),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    /** The design's `version` when taken. */
    version: integer().notNull(),
    label: text(),
    data: json<unknown>().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [
    index('website_design_versions_design_idx').on(t.designId, t.createdAt),
    index('website_design_versions_space_idx').on(t.spaceId),
  ],
);

/** A host name the site process serves a space under. */
export const websiteDomains = table(
  'website_domains',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    /** Lower case, ASCII (punycode), no port, no trailing dot; unique across spaces. */
    hostname: text().notNull(),
    /** A pinned locale; null resolves the locale by path prefix. */
    locale: text(),
    /** The canonical host of its space and locale. */
    isPrimary: boolean().notNull().default(false),
    /** Answers every request with a 301 to the primary host. */
    redirectToPrimary: boolean().notNull().default(false),
    ...hostVerification(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('website_domains_hostname_key').on(t.hostname),
    index('website_domains_space_idx').on(t.spaceId),
  ],
);
