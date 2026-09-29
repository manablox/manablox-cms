import {
  type AnyFieldType,
  type BlockValue,
  type ContentTypeDefinition,
  type ContentTypeRegistry,
  type FieldDefinition,
  type FieldValueContext,
  fieldBlocks,
  fieldDefaultValue,
  fieldIsEmpty,
  fieldItems,
  fieldSearchText,
  fieldSubFields,
  fieldSupportsUnique,
  itemsContentType,
  slugify,
  ValidationCollector,
  validateFieldValue,
} from '@manablox/core';
import { keepStoredBlockData } from '../block-extensions.js';
import type { Actor, ContentHookContext, ContentSaveInput } from './types.js';

/** Deeper nesting is a client bug. */
const MAX_BLOCK_DEPTH = 16;

type FieldContext = Omit<FieldValueContext, 'field'>;

/** A field type's default, checked against its `valueSchema`. */
export async function resolveFieldDefault(
  fieldType: AnyFieldType,
  field: FieldDefinition,
  context: FieldContext,
): Promise<{ raw: unknown; value: unknown; issues: ValidationCollector }> {
  const raw = fieldDefaultValue(fieldType, field.settings);
  return { raw, ...(await validateFieldValue(fieldType, field, raw, { ...context, field })) };
}

/** Field values with defaults filled in; an invalid default is `null`, an empty one is kept. */
export async function initFields(
  registry: ContentTypeRegistry,
  contentType: ContentTypeDefinition,
  existing: Record<string, unknown> = {},
  locale = 'en',
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const context: FieldContext = { contentType, locale, spaceId: contentType.spaceId ?? null };

  for (const field of contentType.fields) {
    const fieldType = registry.fieldTypes.tryGet(field.type);
    if (!fieldType) continue;
    if (field.name in existing) {
      out[field.name] = existing[field.name];
      continue;
    }
    // An empty default is fine in a form that has yet to be filled in.
    const { value, issues } = await resolveFieldDefault(
      fieldType,
      { ...field, required: false },
      context,
    );
    out[field.name] = issues.isEmpty ? value : null;
  }
  return out;
}

/**
 * Validates everything, recursing into blocks and building search text. Mutates `input.slug`.
 * With `hookContext`, `field:beforeValidate` runs on every field first; `blockExtensions`
 * checks block `ext` entries. Entries of other plugins come from `stored`, by block id.
 */
export async function validateContent(
  registry: ContentTypeRegistry,
  contentType: ContentTypeDefinition,
  values: Record<string, unknown>,
  input: ContentSaveInput,
  actor: Actor | null,
  hookContext: ContentHookContext | null = null,
  blockExtensions?: FieldValueContext['blockExtensions'],
  stored?: Record<string, unknown>,
): Promise<{ fields: Record<string, unknown>; searchText: string }> {
  const collector = new ValidationCollector();
  const searchParts: string[] = [];

  if (!input.title || input.title.trim().length === 0) {
    collector.add('content.title.required', ['title']);
  }

  if (contentType.hasSlug) {
    const slug = input.slug ?? slugify(input.title ?? '');
    if (!slug) collector.add('content.slug.required', ['slug']);
    input.slug = slug;
  } else {
    input.slug = input.slug ?? slugify(input.title ?? '') ?? '';
  }

  const fields = await validateFieldMap(
    registry,
    contentType,
    values,
    collector,
    searchParts,
    { contentType, locale: input.locale ?? 'en', spaceId: input.spaceId, blockExtensions },
    [],
    actor,
    hookContext?.manablox.hooks.has('field:beforeValidate') ? hookContext : null,
  );

  collector.throwIfAny('content.validation.failed');
  return {
    fields: keepStoredBlockData(fields, stored, blockExtensions ?? new Map()),
    searchText: searchParts.join(' ').slice(0, 100_000),
  };
}

/** Top-level `unique` fields holding a value; block types and empty values are skipped. */
export function uniqueChecks(
  registry: ContentTypeRegistry,
  contentType: ContentTypeDefinition,
  values: Record<string, unknown>,
): { field: FieldDefinition; value: unknown }[] {
  if (contentType.kind === 'block') return [];
  return contentType.fields.flatMap((field) => {
    if (!field.unique) return [];
    const fieldType = registry.fieldTypes.tryGet(field.type);
    if (!fieldType || !fieldSupportsUnique(fieldType, field.settings)) return [];
    const value = values[field.name];
    return fieldIsEmpty(fieldType, value, field.settings) ? [] : [{ field, value }];
  });
}

async function validateFieldMap(
  registry: ContentTypeRegistry,
  contentType: ContentTypeDefinition,
  values: Record<string, unknown>,
  collector: ValidationCollector,
  searchParts: string[],
  context: FieldContext,
  path: (string | number)[],
  actor: Actor | null,
  hookContext: ContentHookContext | null,
  depth = 0,
): Promise<Record<string, unknown>> {
  if (depth > MAX_BLOCK_DEPTH) {
    collector.add('content.blocks.tooDeep', path);
    return {};
  }

  const out: Record<string, unknown> = {};

  for (const field of contentType.fields) {
    const fieldType = registry.fieldTypes.tryGet(field.type);
    if (!fieldType) {
      collector.add('contentType.field.type.notFound', [...path, field.name], {
        type: field.type,
      });
      continue;
    }

    // A handler returning a value for an absent field supplies it.
    const value = hookContext
      ? await hookContext.manablox.hooks.run('field:beforeValidate', values[field.name], {
          ...hookContext,
          contentType,
          field,
        } as never)
      : values[field.name];
    const supplied = field.name in values || value !== undefined;
    const result = supplied
      ? {
          raw: value,
          ...(await validateFieldValue(fieldType, field, value, { ...context, field })),
        }
      : await resolveFieldDefault(fieldType, field, context);

    if (!result.issues.isEmpty) {
      // An unsent default on an optional field is stored empty instead of failing.
      if (!supplied && !field.required) {
        out[field.name] = null;
        continue;
      }
      collector.merge([...result.issues.all], path);
      out[field.name] = result.raw;
      continue;
    }

    // A databag field names a databag type of the same space, or a global one.
    if (field.type === 'databag' && typeof result.value === 'string') {
      const target = registry.tryGet(result.value);
      if (
        target?.kind !== 'data' ||
        target.isSystem ||
        (target.spaceId !== null && target.spaceId !== context.spaceId)
      ) {
        collector.add('field.databag.notFound', [...path, field.name], { id: result.value });
        out[field.name] = result.value;
        continue;
      }
    }

    const text = fieldSearchText(fieldType, result.value, field.settings);
    if (text) searchParts.push(text);

    // Blocks are `kind: 'block'` content types and validate the same way.
    if (fieldType.nested) {
      const blocks = fieldBlocks(fieldType, result.value, field.settings);
      const validated = await Promise.all(
        blocks.map((block, index) =>
          validateBlock(
            registry,
            block,
            collector,
            searchParts,
            context,
            [...path, field.name, index],
            actor,
            hookContext,
            depth + 1,
          ),
        ),
      );
      out[field.name] = isBlocksContainer(result.value)
        ? { ...result.value, blocks: validated }
        : Array.isArray(result.value)
          ? validated
          : (validated[0] ?? null);
      continue;
    }

    // Items validate like blocks, against the field's own sub-fields.
    const subFields = fieldSubFields(fieldType, field.settings);
    if (subFields) {
      const itemType = itemsContentType(contentType, field, subFields);
      out[field.name] = await Promise.all(
        fieldItems(fieldType, result.value, field.settings).map(async (item, index) => ({
          ...item,
          fields: await validateFieldMap(
            registry,
            itemType,
            item.fields,
            collector,
            searchParts,
            { ...context, contentType: itemType },
            [...path, field.name, index],
            actor,
            hookContext,
            depth + 1,
          ),
        })),
      );
      continue;
    }

    out[field.name] = result.value;
  }

  // Values for fields not on the type are dropped.
  return out;
}

async function validateBlock(
  registry: ContentTypeRegistry,
  block: BlockValue,
  collector: ValidationCollector,
  searchParts: string[],
  context: FieldContext,
  path: (string | number)[],
  actor: Actor | null,
  hookContext: ContentHookContext | null,
  depth: number,
): Promise<BlockValue> {
  const blockType = registry.tryGet(block.type);
  if (!blockType) {
    collector.add('content.block.type.notFound', path, { type: block.type });
    return block;
  }
  if (blockType.kind !== 'block') {
    collector.add('content.block.type.notABlock', path, { type: blockType.name });
    return block;
  }

  const fields = await validateFieldMap(
    registry,
    blockType,
    block.fields,
    collector,
    searchParts,
    { ...context, contentType: blockType },
    path,
    actor,
    hookContext,
    depth,
  );

  return { ...block, fields };
}

/** A `blocks` value: blocks plus their grid. */
function isBlocksContainer(value: unknown): value is { blocks: BlockValue[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as { blocks?: unknown }).blocks)
  );
}
