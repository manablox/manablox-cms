import { defineFieldType, type FieldDefinition, type FieldItem } from '@manablox/core';
import { z } from 'zod';

const subField = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  label: z.string().optional(),
  type: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).optional(),
  required: z.boolean().optional(),
  admin: z
    .object({
      width: z.number().min(1).max(100).optional(),
      help: z.string().optional(),
      placeholder: z.string().optional(),
      position: z.number().optional(),
    })
    .partial()
    .optional(),
});

export type RepeaterSubField = z.infer<typeof subField>;

export const repeaterSettings = z.object({
  /** What every item holds. Names are machine names, unique within the repeater. */
  fields: z.array(subField).default([]),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
});

export type RepeaterSettings = z.infer<typeof repeaterSettings>;

/** Settings arrive undefaulted, so sub-fields are completed here. Items are never localized. */
export function repeaterSubFields(settings: Partial<RepeaterSettings>): FieldDefinition[] {
  const raw = Array.isArray(settings?.fields) ? settings.fields : [];
  return raw
    .filter(
      (entry): entry is RepeaterSubField =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.name === 'string' &&
        typeof entry.type === 'string',
    )
    .map((entry, index) => ({
      id: entry.id ?? entry.name,
      name: entry.name,
      label: entry.label ?? entry.name,
      type: entry.type,
      settings: entry.settings ?? {},
      required: entry.required ?? false,
      localized: false,
      unique: false,
      admin: {
        zone: 'main',
        width: entry.admin?.width ?? 100,
        position: entry.admin?.position ?? index,
        ...(entry.admin?.help !== undefined ? { help: entry.admin.help } : {}),
        ...(entry.admin?.placeholder !== undefined ? { placeholder: entry.admin.placeholder } : {}),
      },
    }));
}

const repeaterItem: z.ZodType<FieldItem> = z.object({
  itemId: z.string().uuid(),
  /** Keyed by sub-field name; validated recursively by the service. */
  fields: z.record(z.string(), z.unknown()),
});

/** A list of items, each filled against the same inline sub-fields. */
export const repeaterField = defineFieldType<RepeaterSettings, FieldItem[]>({
  name: 'repeater',
  label: 'Repeater',
  icon: 'i-lucide-list-plus',
  description: 'A list of items, each made of the same set of fields.',

  settingsSchema: repeaterSettings,

  valueSchema: (settings) =>
    z.array(repeaterItem).superRefine((items, ctx) => {
      if (settings.min !== undefined && items.length < settings.min) {
        ctx.addIssue({ code: 'custom', message: `At least ${settings.min} items.` });
      }
      if (settings.max !== undefined && items.length > settings.max) {
        ctx.addIssue({ code: 'custom', message: `At most ${settings.max} items.` });
      }
    }),

  defaultValue: () => [],
  isEmpty: (value) => Array.isArray(value) && value.length === 0,
  storage: { kind: 'jsonb', index: false },
  filters: ['isNull', 'isNotNull'],
  graphql: { type: { kind: 'items' }, list: true },
  subFields: repeaterSubFields,
  items: (value) => (Array.isArray(value) ? value : []),

  admin: { input: 'repeater', settings: 'repeater' },
});
