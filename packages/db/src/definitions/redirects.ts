import type { RedirectSource } from '@manablox/core';
import { id, index, integer, table, text, timestamp, unique, uuid } from './define.js';
import { environmentId } from './scoped.js';
import { spaces } from './spaces.js';

/**
 * A path answered with a redirect: to a path, or to a document by its localization group.
 * `locale` null applies to every locale.
 */
export const redirects = table(
  'redirects',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    environmentId: environmentId(),
    locale: text(),
    /** Leading slash, no trailing slash, no locale prefix. */
    fromPath: text().notNull(),
    toPath: text(),
    /** A `localizationId`; no foreign key, since no table keys one. */
    toContentId: uuid(),
    /** 301 or 302. */
    status: integer().notNull().default(301),
    source: text<RedirectSource>().notNull().default('manual'),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
    createdBy: uuid(),
  },
  (t) => [
    unique('redirects_environment_locale_from_key')
      .on(t.environmentId, t.locale, t.fromPath)
      .nullsNotDistinct(),
    index('redirects_target_idx').on(t.spaceId, t.toContentId),
  ],
);
