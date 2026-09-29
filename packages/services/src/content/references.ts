import {
  type ContentTypeDefinition,
  type ContentTypeRegistry,
  type FieldReference,
  fieldBlocks,
  fieldItems,
  fieldReferences,
  fieldSubFields,
  itemsContentType,
} from '@manablox/core';
import type { ContentRow } from '@manablox/db';

/** Every asset/content/user id reachable from a row, blocks and items included. */
export function collectReferences(
  registry: ContentTypeRegistry,
  row: Pick<ContentRow, 'typeId' | 'fields'>,
): FieldReference[] {
  const contentType = registry.tryGet(row.typeId);
  if (!contentType) return [];

  const out: FieldReference[] = [];
  const walk = (type: ContentTypeDefinition, values: Record<string, unknown>, depth: number) => {
    if (depth > 16) return;
    for (const field of type.fields) {
      const fieldType = registry.fieldTypes.tryGet(field.type);
      if (!fieldType) continue;
      const value = values[field.name];
      out.push(...fieldReferences(fieldType, value, field.settings));

      if (fieldType.nested) {
        for (const block of fieldBlocks(fieldType, value, field.settings)) {
          const blockType = registry.tryGet(block.type);
          if (blockType) walk(blockType, block.fields, depth + 1);
        }
      }

      const subFields = fieldSubFields(fieldType, field.settings);
      if (subFields) {
        const itemType = itemsContentType(type, field, subFields);
        for (const item of fieldItems(fieldType, value, field.settings)) {
          walk(itemType, item.fields, depth + 1);
        }
      }
    }
  };

  walk(contentType, row.fields, 0);
  return out;
}
