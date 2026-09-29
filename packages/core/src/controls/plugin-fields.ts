import {
  fieldBlocks,
  fieldIsEmpty,
  fieldItems,
  fieldSubFields,
  itemsContentType,
} from '../field-type.js';
import type { ContentTypeRegistry } from '../registry.js';
import type { ContentTypeDefinition } from '../types.js';
import type { FeatureKey } from './catalogue.js';

const MAX_DEPTH = 16;

interface PluginValue {
  feature: FeatureKey;
  json: string;
}

/** Plugin flags whose field values differ between `fields` and `previous`, at any depth. */
export function changedPluginFeatures(
  registry: ContentTypeRegistry,
  flags: ReadonlyMap<string, FeatureKey>,
  contentType: ContentTypeDefinition,
  fields: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
): Set<FeatureKey> {
  const next = collectPluginValues(registry, flags, contentType, fields);
  const before = previous
    ? collectPluginValues(registry, flags, contentType, previous)
    : new Map<string, PluginValue>();
  const changed = new Set<FeatureKey>();
  for (const [path, value] of next) {
    if (before.get(path)?.json !== value.json) changed.add(value.feature);
  }
  for (const [path, value] of before) {
    if (!next.has(path)) changed.add(value.feature);
  }
  return changed;
}

/** Filled plugin field values by path; blocks and items are keyed by their ids. */
function collectPluginValues(
  registry: ContentTypeRegistry,
  flags: ReadonlyMap<string, FeatureKey>,
  contentType: ContentTypeDefinition,
  fields: Record<string, unknown>,
): Map<string, PluginValue> {
  const out = new Map<string, PluginValue>();
  const walk = (
    type: ContentTypeDefinition,
    values: Record<string, unknown>,
    prefix: string,
    depth: number,
  ) => {
    if (depth > MAX_DEPTH) return;
    for (const field of type.fields) {
      const value = values[field.name];
      const fieldType = registry.fieldTypes.tryGet(field.type);
      if (!fieldType || fieldIsEmpty(fieldType, value, field.settings)) continue;
      const path = `${prefix}${field.name}`;
      const feature = flags.get(field.type);
      if (feature) out.set(path, { feature, json: JSON.stringify(value) });

      if (fieldType.nested) {
        const blocks = fieldBlocks(fieldType, value, field.settings);
        (Array.isArray(blocks) ? blocks : []).forEach((block, index) => {
          if (!isRecord(block) || !isRecord(block.fields)) return;
          const blockType = registry.tryGet(block.type);
          const key = typeof block.blockId === 'string' ? block.blockId : index;
          if (blockType) walk(blockType, block.fields, `${path}/${key}/`, depth + 1);
        });
      }
      const subFields = fieldSubFields(fieldType, field.settings);
      if (subFields) {
        const itemType = itemsContentType(type, field, subFields);
        const items = fieldItems(fieldType, value, field.settings);
        (Array.isArray(items) ? items : []).forEach((item, index) => {
          if (!isRecord(item) || !isRecord(item.fields)) return;
          const key = typeof item.itemId === 'string' ? item.itemId : index;
          walk(itemType, item.fields, `${path}/${key}/`, depth + 1);
        });
      }
    }
  };
  walk(contentType, fields, '', 0);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
