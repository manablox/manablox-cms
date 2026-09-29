import { defineContentType } from './content-type.js';
import type { ContentTypeRegistry } from './registry.js';
import type { BlocksValue, ContentTypeDefinition, FieldDefinition } from './types.js';

/** The built-in global types; `isSystem` keeps them out of type pickers. */
export const FOLDER_TYPE_NAME = 'folder';
export const TEMPLATE_TYPE_NAME = 'template';

/** The template type's one field. Delivery reads the blocks through it. */
export const TEMPLATE_BLOCKS_FIELD = 'blocks';

/** Structures the tree only: no slug, so it adds no permalink segment; no page, no menu entry. */
const folderContentType: ContentTypeDefinition = defineContentType({
  name: FOLDER_TYPE_NAME,
  label: 'Folder',
  description: 'Groups documents in the tree without adding a level to their address.',
  icon: 'i-lucide-folder',
  hasSlug: false,
  isPublishable: false,
  isVisibleInTree: true,
  canBeVisibleInMenu: false,
  isSystem: true,
  fields: [],
});

/**
 * A shared block list. Publishable, since delivery reads only published templates.
 * `types: []` allows every block type of the space.
 */
const templateContentType: ContentTypeDefinition = defineContentType({
  name: TEMPLATE_TYPE_NAME,
  label: 'Template',
  description: 'A reusable set of blocks, referenced from a template field.',
  icon: 'i-lucide-layout-template',
  hasSlug: false,
  isPublishable: true,
  isVisibleInTree: false,
  canBeVisibleInMenu: false,
  isSystem: true,
  fields: [
    {
      name: TEMPLATE_BLOCKS_FIELD,
      label: 'Blocks',
      type: 'blocks',
      localized: true,
      settings: { types: [] },
    },
  ],
});

export const systemContentTypes: readonly ContentTypeDefinition[] = Object.freeze([
  folderContentType,
  templateContentType,
]);

export function isFolderType(type: Pick<ContentTypeDefinition, 'name' | 'isSystem'>): boolean {
  return type.isSystem && type.name === FOLDER_TYPE_NAME;
}

export function isTemplateType(type: Pick<ContentTypeDefinition, 'name' | 'isSystem'>): boolean {
  return type.isSystem && type.name === TEMPLATE_TYPE_NAME;
}

/** A template document's blocks, found by field type rather than name; `null` if none. */
export function readTemplateBlocks(
  registry: ContentTypeRegistry,
  row: { typeId: string; fields: Record<string, unknown> } | null | undefined,
): BlocksValue | null {
  if (!row) return null;
  const type = registry.tryGet(row.typeId);
  if (!type || !isTemplateType(type)) return null;

  const field = type.fields.find((candidate: FieldDefinition) => candidate.type === 'blocks');
  if (!field) return null;

  const value = row.fields[field.name];
  if (Array.isArray(value)) return { blocks: value };
  if (value && typeof value === 'object' && Array.isArray((value as BlocksValue).blocks)) {
    return value as BlocksValue;
  }
  return null;
}
