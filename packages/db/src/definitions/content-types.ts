import type { ContentTypeKind, FieldDefinition } from '@manablox/core';
import { boolean, id, json, table, text, timestamp, unique, uuid } from './define.js';
import { spaceEnvironments, spaces } from './spaces.js';

/** Runtime-defined content types only; code-defined ones live in the registry. */
export const contentTypes = table(
  'content_types',
  {
    id: id(),
    spaceId: uuid().references(() => spaces, 'id', { onDelete: 'cascade' }),
    /** Set exactly when `spaceId` is: global types belong to no environment. */
    environmentId: uuid().references(() => spaceEnvironments, 'id', { onDelete: 'cascade' }),
    name: text().notNull(),
    label: text().notNull(),
    description: text(),
    icon: text(),
    kind: text<ContentTypeKind>().notNull().default('content'),
    hasSlug: boolean().notNull().default(true),
    isPublishable: boolean().notNull().default(true),
    isVisibleInTree: boolean().notNull().default(true),
    canBeVisibleInMenu: boolean().notNull().default(true),
    requiresApproval: boolean().notNull().default(false),
    fields: json<FieldDefinition[]>().notNull().default([]),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT, or global types (NULL environment_id) could share a name.
    unique('content_types_environment_name_key').on(t.environmentId, t.name).nullsNotDistinct(),
  ],
);
