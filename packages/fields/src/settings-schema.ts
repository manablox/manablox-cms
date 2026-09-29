import type { AnyFieldType } from '@manablox/core';

/** A field type's settings as compact JSON Schema. */
export function settingsSchemaOf(type: AnyFieldType): string | null {
  const schema = type.settingsSchema as unknown as { toJSONSchema?: () => unknown };
  if (typeof schema.toJSONSchema !== 'function') return null;
  try {
    return JSON.stringify(compactSchema(schema.toJSONSchema()));
  } catch {
    return null;
  }
}

const SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'items',
  'enum',
  'const',
  'default',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'anyOf',
  'oneOf',
  'format',
  'pattern',
  'description',
]);

function compactSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compactSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [
          name,
          compactSchema(child),
        ]),
      );
    } else if (SCHEMA_KEYS.has(key)) out[key] = compactSchema(value);
  }
  return out;
}
