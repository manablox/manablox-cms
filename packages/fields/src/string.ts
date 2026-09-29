import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

export const stringSettings = z.object({
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  default: z.string().optional(),
  /** Bare pattern; anchored automatically. */
  pattern: z.string().optional(),
  editor: z.enum(['input', 'textarea', 'code']).default('input'),
  /** Syntax highlighting hint when `editor` is `code`. */
  language: z.string().optional(),
});

export type StringSettings = z.infer<typeof stringSettings>;

export const stringField = defineFieldType<StringSettings, string>({
  name: 'string',
  label: 'Text',
  icon: 'i-lucide-type',
  description: 'Single-line text, a textarea, or a code block.',

  settingsSchema: stringSettings,

  valueSchema: (settings) => {
    let schema = z.string();
    if (settings.min !== undefined) schema = schema.min(settings.min);
    if (settings.max !== undefined) schema = schema.max(settings.max);
    if (settings.pattern) schema = schema.regex(new RegExp(settings.pattern));
    return schema;
  },

  defaultValue: (settings) => settings.default ?? '',
  isEmpty: (value) => typeof value === 'string' && value.trim() === '',
  unique: true,

  // `code` is never filtered on, so no index.
  storage: (settings) => ({
    kind: 'jsonb',
    index: settings.editor === 'code' ? false : 'btree',
  }),

  filters: [
    'eq',
    'neq',
    'in',
    'notIn',
    'contains',
    'startsWith',
    'endsWith',
    'isNull',
    'isNotNull',
  ],
  graphql: { type: { kind: 'scalar', name: 'String' } },
  search: (value) => value || null,

  admin: { input: 'string', settings: 'string', summary: true },
});
