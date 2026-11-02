import { type ContentTypeSummary, type FieldDefinition, htmlToRichText } from '@manablox/admin-sdk';
import type { BlocksValue, BlockValue } from '@manablox/core';

/** One repeater row. */
export interface RepeaterItem {
  itemId: string;
  fields: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value as a list of items; anything malformed is dropped. */
function itemsOf(value: unknown): RepeaterItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RepeaterItem =>
      isRecord(entry) && typeof entry.itemId === 'string' && isRecord(entry.fields),
  );
}

/** Names of a repeater's rich text sub-fields, from its stored `settings.fields`. */
function richTextSubFields(settings: Record<string, unknown> | undefined): Set<string> {
  const raw = Array.isArray(settings?.fields) ? settings.fields : [];
  return new Set(
    raw.flatMap((entry) =>
      isRecord(entry) && entry.type === 'richtext' && typeof entry.name === 'string'
        ? [entry.name]
        : [],
    ),
  );
}

/** An image a generated document asked for: briefed by the text model, drawn by the image model. */
export interface GeneratedImage {
  /** An asset field, or the block field holding it. */
  field: string;
  /** Set when it belongs to a block. */
  blockId?: string | null | undefined;
  blockField?: string | null | undefined;
  label: string;
  prompt: string;
  aspectRatio?: string | null | undefined;
  /** Set once drawn. */
  assetId: string | null;
  url: string | null;
}

/** A generated document ready for a draft; block values are already in editor form. */
export interface GeneratedDocument {
  /** Field name -> value; rich text stays HTML until applied. */
  fields: Record<string, string>;
  /** Block field name -> value, grid included. */
  blocks: Record<string, BlocksValue>;
  /** Repeater field name -> items, rich text already parsed. */
  items: Record<string, RepeaterItem[]>;
  /** Drawn images; a block's own are already in `blocks`. */
  images: GeneratedImage[];
}

/** Generated blocks as a field value, rich text parsed with the editor's parser. */
export async function toBlocksValue(
  blocks: BlockValue[],
  grid: BlocksValue['grid'],
  typeById: (id: string) => ContentTypeSummary | null,
): Promise<BlocksValue> {
  const parsed = await Promise.all(
    blocks.map(async (block) => ({ ...block, fields: await readBlockFields(block, typeById) })),
  );
  return grid ? { grid, blocks: parsed } : { blocks: parsed };
}

async function readBlockFields(
  block: BlockValue,
  typeById: (id: string) => ContentTypeSummary | null,
): Promise<Record<string, unknown>> {
  const type = typeById(block.type);
  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(block.fields)) {
    const definition = type?.fields.find((entry) => entry.name === name);
    fields[name] =
      definition?.type === 'richtext' && typeof value === 'string'
        ? await htmlToRichText(value)
        : value;
  }
  return fields;
}

/** Generated repeater items as a field value, rich text sub-fields parsed. */
export async function toItemsValue(
  items: unknown,
  field: FieldDefinition | undefined,
): Promise<RepeaterItem[]> {
  const richText = richTextSubFields(field?.settings);
  return Promise.all(
    itemsOf(items).map(async (item) => {
      const fields: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(item.fields)) {
        fields[name] =
          richText.has(name) && typeof value === 'string' ? await htmlToRichText(value) : value;
      }
      return { itemId: item.itemId, fields };
    }),
  );
}

/** A list or a single id, per the field's setting. */
export function assetValue(settings: Record<string, unknown>, assetId: string): unknown {
  return settings.multiple === true ? [assetId] : assetId;
}

/** The blocks with one block's field replaced. */
export function withBlockField(
  value: BlocksValue,
  blockId: string,
  field: string,
  fieldValue: unknown,
): BlocksValue {
  return {
    ...value,
    blocks: value.blocks.map((block) =>
      block.blockId === blockId
        ? { ...block, fields: { ...block.fields, [field]: fieldValue } }
        : block,
    ),
  };
}
