import { defineFieldType } from '@manablox/core';
import { z } from 'zod';

export const templateSettings = z.object({
  /** Allowed template documents. Empty means all. */
  templates: z.array(z.string().uuid()).default([]),
  default: z.string().uuid().optional(),
});

export type TemplateSettings = z.infer<typeof templateSettings>;

/** References a template whose blocks are delivered in place; they stay in the template. */
export const templateField = defineFieldType<TemplateSettings, string | null>({
  name: 'template',
  label: 'Content template',
  icon: 'i-lucide-layout-template',

  settingsSchema: templateSettings,
  valueSchema: () => z.string().uuid().nullable(),
  defaultValue: (settings) => settings.default ?? null,
  storage: { kind: 'jsonb', index: 'btree' },
  filters: ['eq', 'neq', 'in', 'notIn', 'isNull', 'isNotNull'],
  // Delivered as the template's block list.
  graphql: { type: { kind: 'blockRef' } },
  references: (value) => (value ? [{ target: 'content' as const, id: value }] : []),

  admin: { input: 'template', settings: 'template' },
});
