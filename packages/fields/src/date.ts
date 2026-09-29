import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

export const dateSettings = z.object({
  /** `date`: `YYYY-MM-DD`; `datetime`: ISO-8601 instant. */
  mode: z.enum(['date', 'datetime']).default('datetime'),
  min: z.string().optional(),
  max: z.string().optional(),
  default: z.string().optional(),
  /** Defaults to `now()` on creation. */
  defaultNow: z.boolean().default(false),
});

export type DateSettings = z.infer<typeof dateSettings>;

/** Stored as an ISO string, sortable as text. */
export const dateField = defineFieldType<DateSettings, string>({
  name: 'date',
  label: 'Date',
  icon: 'i-lucide-calendar',

  settingsSchema: dateSettings,

  valueSchema: (settings) =>
    settings.mode === 'date'
      ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
      : z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'expected an ISO-8601 date'),

  defaultValue: (settings) => {
    if (settings.default) return settings.default;
    // Not `''`, which `valueSchema` would reject.
    if (!settings.defaultNow) return null;
    const now = new Date();
    return settings.mode === 'date'
      ? (now.toISOString().slice(0, 10) as string)
      : now.toISOString();
  },

  isEmpty: (value) => value === '',
  unique: true,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'isNotNull'],
  graphql: { type: { kind: 'scalar', name: 'DateTime' } },

  admin: { input: 'date', settings: 'date' },
});
