import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

export const databagSettings = z.object({
  /** Databag types editors may pick. Empty means all. */
  types: z.array(z.string().uuid()).default([]),
});

export type DatabagSettings = z.infer<typeof databagSettings>;

/** A databag type, picked by editors; a site form bound to the field stores entries there. */
export const databagField = defineFieldType<DatabagSettings, string | null>({
  name: 'databag',
  label: 'Databag type',
  icon: 'i-lucide-database',
  description:
    'A databag type picked by editors; a site form bound to it asks for its fields and stores what visitors send there.',

  settingsSchema: databagSettings,
  valueSchema: (settings) => {
    const id = z.string().uuid();
    const types = settings.types ?? [];
    const allowed = types.length
      ? id.refine((value) => types.includes(value), 'not an allowed databag type')
      : id;
    return allowed.nullable();
  },
  defaultValue: () => null,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  graphql: { type: { kind: 'scalar', name: 'String' } },

  admin: { input: 'databag', settings: 'databag' },
});
