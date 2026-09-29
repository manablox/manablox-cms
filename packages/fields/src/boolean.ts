import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

export const booleanSettings = z.object({
  default: z.boolean().default(false),
  display: z.enum(['switch', 'checkbox']).default('switch'),
});

export type BooleanSettings = z.infer<typeof booleanSettings>;

export const booleanField = defineFieldType<BooleanSettings, boolean>({
  name: 'boolean',
  label: 'Boolean',
  icon: 'i-lucide-toggle-left',

  settingsSchema: booleanSettings,
  valueSchema: () => z.boolean(),
  defaultValue: (settings) => settings.default,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'isNull', 'isNotNull'],
  graphql: { type: { kind: 'scalar', name: 'Boolean' } },

  admin: { input: 'boolean', settings: 'boolean' },
});
