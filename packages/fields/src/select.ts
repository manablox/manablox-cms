import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

const option = z.object({ value: z.string(), label: z.string().optional() });

export const selectSettings = z.object({
  options: z.array(option).min(1),
  multiple: z.boolean().default(false),
  default: z.union([z.string(), z.array(z.string())]).optional(),
});

export type SelectSettings = z.infer<typeof selectSettings>;

/** An enum field. */
export const selectField = defineFieldType<SelectSettings, string | string[]>({
  name: 'select',
  label: 'Select',
  icon: 'i-lucide-list',

  settingsSchema: selectSettings,

  valueSchema: (settings) => {
    const values = settings.options.map((entry) => entry.value);
    const single = z.string().refine((value) => values.includes(value), 'not an allowed option');
    return settings.multiple ? z.array(single) : single;
  },

  // `null`, not `''`, which `valueSchema` would reject.
  defaultValue: (settings) => settings.default ?? (settings.multiple ? [] : null),
  isEmpty: (value) => (Array.isArray(value) ? value.length === 0 : value === ''),
  unique: (settings) => !settings.multiple,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  graphql: (settings) => ({
    type: { kind: 'scalar', name: 'String' },
    list: settings.multiple,
  }),
  search: (value) => (Array.isArray(value) ? value.join(' ') : value || null),

  admin: { input: 'select', settings: 'select', summary: true },
});
