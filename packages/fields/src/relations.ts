import { defineFieldType } from '@manablox/core';
import { z } from 'zod';
import { imageSize } from './image-sizes.js';

const uuidSchema = z.string().uuid();

const relationSettings = z.object({
  multiple: z.boolean().default(false),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  /** `filter` resolves a query on every read and stores nothing; needs `multiple`. */
  selection: z.enum(['pick', 'filter']).default('pick'),
  /** Page size of a `filter` field. */
  limit: z.number().int().min(1).max(100).default(10),
  /** Page offset of a `filter` field. */
  offset: z.number().int().nonnegative().default(0),
  /** Free-text query a `filter` field narrows by. */
  search: z.string().max(200).optional(),
});

/** Whether a relation field is a query rather than a picked list; requires `multiple`. */
export function isFilterRelation(settings: { multiple?: boolean; selection?: string }): boolean {
  return settings.multiple === true && settings.selection === 'filter';
}

// Asset relation

export const assetSettings = relationSettings.extend({
  /** Mime-type prefixes, e.g. `['image/', 'video/']`. */
  accept: z.array(z.string()).default([]),
  /** Configured presets this field delivers. Empty means all. */
  presets: z.array(z.string()).default([]),
  /** Extra image renditions by dimensions. */
  sizes: z.array(imageSize).max(12).default([]),
  default: z.union([z.string(), z.array(z.string())]).optional(),
});

export type AssetSettings = z.infer<typeof assetSettings>;

export const assetField = defineFieldType<AssetSettings, string | string[] | null>({
  name: 'asset',
  label: 'Asset',
  icon: 'i-lucide-image',

  settingsSchema: assetSettings,
  valueSchema: (settings) => (settings.multiple ? z.array(uuidSchema) : uuidSchema.nullable()),
  defaultValue: (settings) => settings.default ?? (settings.multiple ? [] : null),
  isEmpty: isEmptyRelation,
  unique: isSingleRelation,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  graphql: (settings) => ({ type: { kind: 'ref', target: 'asset' }, list: settings.multiple }),
  // A `filter` field stores nothing, so it holds no references.
  references: (value, settings) =>
    isFilterRelation(settings) ? [] : toIds(value).map((id) => ({ target: 'asset' as const, id })),

  admin: { input: 'asset', settings: 'asset' },
});

// Content relation

export const contentSettings = relationSettings.extend({
  /** Content type ids this field may point at. Empty means any. */
  types: z.array(z.string()).default([]),
  /** Restrict candidates to a subtree. */
  under: z.string().optional(),
  /** Order of a `filter` field's rows. */
  sortBy: z
    .enum(['position', 'title', 'createdAt', 'updatedAt', 'publishedAt', 'slug'])
    .default('position'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
  default: z.union([z.string(), z.array(z.string())]).optional(),
});

export type ContentSettings = z.infer<typeof contentSettings>;

export const contentField = defineFieldType<ContentSettings, string | string[] | null>({
  name: 'content',
  label: 'Content reference',
  icon: 'i-lucide-link',

  settingsSchema: contentSettings,
  valueSchema: (settings) => (settings.multiple ? z.array(uuidSchema) : uuidSchema.nullable()),
  defaultValue: (settings) => settings.default ?? (settings.multiple ? [] : null),
  isEmpty: isEmptyRelation,
  unique: isSingleRelation,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  graphql: (settings) => ({ type: { kind: 'ref', target: 'content' }, list: settings.multiple }),
  references: (value, settings) =>
    isFilterRelation(settings)
      ? []
      : toIds(value).map((id) => ({ target: 'content' as const, id })),

  admin: { input: 'content', settings: 'content' },
});

// User relation

export const userSettings = relationSettings.extend({
  roles: z.array(z.string()).default([]),
  /** Fills in the acting user on creation. */
  defaultCurrentUser: z.boolean().default(false),
});

export type UserSettings = z.infer<typeof userSettings>;

export const userField = defineFieldType<UserSettings, string | string[] | null>({
  name: 'user',
  label: 'User reference',
  icon: 'i-lucide-user',

  settingsSchema: userSettings,
  valueSchema: (settings) => (settings.multiple ? z.array(uuidSchema) : uuidSchema.nullable()),
  defaultValue: (settings) => (settings.multiple ? [] : null),
  isEmpty: isEmptyRelation,
  unique: isSingleRelation,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  graphql: (settings) => ({ type: { kind: 'ref', target: 'user' }, list: settings.multiple }),
  references: (value) => toIds(value).map((id) => ({ target: 'user' as const, id })),

  admin: { input: 'user', settings: 'user' },
});

/** An empty pick list; a `filter` field stores nothing, so it is never empty. */
function isEmptyRelation(value: unknown, settings: { multiple?: boolean; selection?: string }) {
  return !isFilterRelation(settings) && Array.isArray(value) && value.length === 0;
}

function isSingleRelation(settings: { multiple?: boolean }): boolean {
  return !settings.multiple;
}

function toIds(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}
