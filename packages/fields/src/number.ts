import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

export const numberSettings = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  integer: z.boolean().default(false),
  default: z.number().optional(),
  /** Display hint only. */
  format: z.enum(['plain', 'currency', 'percent']).default('plain'),
  currency: z.string().length(3).optional(),
});

export type NumberSettings = z.infer<typeof numberSettings>;

export const numberField = defineFieldType<NumberSettings, number>({
  name: 'number',
  label: 'Number',
  icon: 'i-lucide-hash',

  settingsSchema: numberSettings,

  valueSchema: (settings) => {
    let schema = settings.integer ? z.number().int() : z.number();
    if (settings.min !== undefined) schema = schema.min(settings.min);
    if (settings.max !== undefined) schema = schema.max(settings.max);
    return schema;
  },

  defaultValue: (settings) => settings.default ?? 0,
  unique: true,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'notIn', 'isNull', 'isNotNull'],
  graphql: (settings) => ({
    type: { kind: 'scalar', name: settings.integer ? 'Int' : 'Float' },
  }),

  admin: { input: 'number', settings: 'number' },
});
