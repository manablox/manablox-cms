import type {
  EnvironmentCreateMode,
  EnvironmentKind,
  SpaceImportProgress,
  SpaceImportStatus,
} from '@manablox/core';
import { sql } from 'drizzle-orm';
import {
  type AnyTableDefinition,
  id,
  index,
  json,
  table,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from './define.js';

/** Spaces the control API limits together; a space is in at most one. */
export const spaceGroups = table('space_groups', {
  id: id(),
  /** The external layer's own id for the group. */
  externalId: text().unique('space_groups_external_id_key'),
  name: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow(),
});

export const spaces = table(
  'spaces',
  {
    id: id(),
    name: text().notNull(),
    machineName: text().notNull(),
    description: text(),
    /** Public frontend origin, used by the visual editor. */
    url: text().notNull(),
    defaultLocale: text().notNull().default('en'),
    locales: json<string[]>().notNull().default(['en']),
    settings: json<Record<string, unknown>>().notNull().default({}),
    /** Set while an import runs or after it failed; `null` is ready. */
    importStatus: text<SpaceImportStatus>(),
    importProgress: json<SpaceImportProgress>(),
    groupId: uuid().references(() => spaceGroups, 'id', { onDelete: 'set null' }),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('spaces_machine_name_key').on(t.machineName),
    index('spaces_group_idx').on(t.groupId),
  ],
);

/** A copy of a space's content and config; exactly one per space is `production`. */
export const spaceEnvironments = table(
  'space_environments',
  {
    id: id(),
    spaceId: uuid()
      .notNull()
      .references(() => spaces, 'id', { onDelete: 'cascade' }),
    /** Addresses the environment, e.g. `production` or `staging`; unique per space. */
    machineName: text().notNull(),
    name: text().notNull(),
    /** Never changes after create. */
    kind: text<EnvironmentKind>().notNull(),
    /** The environment it was copied from; null for production. */
    createdFrom: uuid().references((): AnyTableDefinition => spaceEnvironments, 'id', {
      onDelete: 'set null',
    }),
    createdMode: text<EnvironmentCreateMode>(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('space_environments_space_machine_name_key').on(t.spaceId, t.machineName),
    uniqueIndex('space_environments_production_key').on(t.spaceId).where(sql`kind = 'production'`),
  ],
);
