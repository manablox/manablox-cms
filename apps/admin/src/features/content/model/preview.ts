import {
  blocksOf,
  gridValueOf,
  isBlockGrid,
  resolveBlockGrid,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import type {
  ContentTypeSummary,
  FieldDefinition,
  FieldTypeMeta,
} from '@manablox/admin-sdk/lib/api-types';
import type { InlineEditable, PreviewMeta } from '@manablox/live-preview';

/** The preview document with block type ids replaced by names, as frontends expect. */
export function withBlockTypeNames(
  value: unknown,
  nameOf: (typeId: string) => string | null | undefined,
): unknown {
  if (Array.isArray(value)) return value.map((entry) => withBlockTypeNames(entry, nameOf));
  if (!isRecord(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) out[key] = withBlockTypeNames(entry, nameOf);

  if (typeof value.blockId === 'string' && typeof value.type === 'string') {
    out.type = nameOf(value.type) ?? value.type;
  }
  return out;
}

/** Inline-editable fields, block labels and grids, collected recursively through blocks. */
export function buildPreviewMeta(
  fields: Record<string, unknown>,
  contentType: ContentTypeSummary,
  typeById: (id: string) => ContentTypeSummary | null,
  fieldTypeMeta: (name: string) => FieldTypeMeta | null,
): PreviewMeta {
  const meta: PreviewMeta = { editable: { title: { kind: 'text' } }, labels: {}, grids: {} };

  const walk = (owner: ContentTypeSummary, values: Record<string, unknown>, prefix: string) => {
    for (const field of owner.fields) {
      const key = prefix ? `${prefix}.${field.name}` : field.name;
      const inline = inlineEditableOf(field);
      if (inline) meta.editable[key] = inline;

      if (!fieldTypeMeta(field.type)?.nested) continue;
      const value = values[field.name];
      const isList = field.type !== 'block';
      if (isList) {
        const grid = resolveBlockGrid(gridValueOf(value));
        if (isBlockGrid(grid)) meta.grids[key] = grid;
      }

      const blocks = isList ? blocksOf(value) : isRecord(value) ? [value] : [];
      blocks.forEach((entry, index) => {
        if (!isRecord(entry) || typeof entry.type !== 'string') return;
        const blockType = typeById(entry.type);
        const blockKey = isList ? `${key}.${index}` : key;
        meta.labels[blockKey] = blockType?.label ?? 'Block';
        if (blockType && isRecord(entry.fields)) walk(blockType, entry.fields, blockKey);
      });
    }
  };
  walk(contentType, fields, '');
  return meta;
}

/** How a field may be edited in the frame, if at all. */
function inlineEditableOf(field: FieldDefinition): InlineEditable | null {
  if (field.type === 'richtext') {
    const toolbar = Array.isArray(field.settings.toolbar)
      ? (field.settings.toolbar as string[])
      : DEFAULT_RICH_TEXT_TOOLBAR;
    return { kind: 'richtext', toolbar };
  }
  if (field.type === 'string') return field.settings.editor === 'code' ? null : { kind: 'text' };
  if (field.type === 'number') return { kind: 'text' };
  return null;
}

/** Mirrors the rich text field type's default toolbar. */
const DEFAULT_RICH_TEXT_TOOLBAR = [
  'bold',
  'italic',
  'link',
  'heading',
  'bulletList',
  'orderedList',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
