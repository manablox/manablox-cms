import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';

/** How deep repeaters may nest, as the server enforces. */
export const MAX_REPEATER_DEPTH = 2;

/** One repeater row. */
export interface RepeaterItem {
  itemId: string;
  fields: Record<string, unknown>;
}

/** A repeater's sub-field as stored in its settings. */
export interface RawSubField {
  id?: string;
  name: string;
  label?: string;
  type: string;
  settings?: Record<string, unknown>;
  required?: boolean;
  admin?: { width?: number; help?: string; placeholder?: string; position?: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `settings.fields` completed like the server does, in stored order; items are never localized. */
export function completeSubFields(
  settings: Record<string, unknown> | undefined,
): FieldDefinition[] {
  const raw = Array.isArray(settings?.fields) ? settings.fields : [];
  return raw
    .filter(
      (entry): entry is RawSubField =>
        isRecord(entry) && typeof entry.name === 'string' && typeof entry.type === 'string',
    )
    .map((entry, index) => ({
      id: entry.id || entry.name,
      name: entry.name,
      label: entry.label || entry.name,
      type: entry.type,
      settings: entry.settings ?? {},
      required: entry.required ?? false,
      localized: false,
      unique: false,
      admin: {
        zone: 'main' as const,
        width: entry.admin?.width ?? 100,
        position: entry.admin?.position ?? index,
        ...(entry.admin?.help !== undefined ? { help: entry.admin.help } : {}),
        ...(entry.admin?.placeholder !== undefined ? { placeholder: entry.admin.placeholder } : {}),
      },
    }));
}

/** A field definition trimmed to what a sub-field stores. */
export function toRawSubField(field: FieldDefinition): RawSubField {
  const { width, help, placeholder, position } = field.admin;
  return {
    id: field.id,
    name: field.name,
    label: field.label,
    type: field.type,
    settings: field.settings,
    required: field.required,
    admin: {
      width,
      position,
      ...(help !== undefined ? { help } : {}),
      ...(placeholder !== undefined ? { placeholder } : {}),
    },
  };
}

/** The value as a list of items; anything malformed is dropped. */
export function itemsOf(value: unknown): RepeaterItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RepeaterItem =>
      isRecord(entry) && typeof entry.itemId === 'string' && isRecord(entry.fields),
  );
}

export function newItem(): RepeaterItem {
  return { itemId: crypto.randomUUID(), fields: {} };
}
