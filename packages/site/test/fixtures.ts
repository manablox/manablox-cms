import type { FieldDefinition } from '@manablox/core';

export function field(
  id: string,
  type: string,
  settings: Record<string, unknown> = {},
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    id,
    name: id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    type,
    settings,
    required: false,
    localized: false,
    unique: false,
    admin: { zone: 'main', width: 100, position: 0 },
    ...extra,
  };
}

/** Positions follow the array order. */
export function typeWith(fields: FieldDefinition[], id = 'type-1') {
  return {
    id,
    fields: fields.map((entry, index) => ({
      ...entry,
      admin: { ...entry.admin, position: index },
    })),
  };
}
