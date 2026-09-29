import { resolveBlockGrid } from './layout.js';
import type { Block, BlockGridSettings, BlockGridValue, BlockLayout, FieldItem } from './types.js';

/** Block keys plugins deliver next to a block's fields; none unless the client names them. */
export const DEFAULT_BLOCK_EXTENSIONS: readonly string[] = [];

export interface NormaliseOptions {
  /**
   * Block keys that are plugin data rather than fields, told apart only on GraphQL blocks,
   * where both sit side by side. Defaults to `DEFAULT_BLOCK_EXTENSIONS`.
   */
  blockExtensions?: readonly string[] | undefined;
}

/**
 * Normalises REST and GraphQL blocks (recognised by `blockId`) to carry `type`, a `fields`
 * map and the values flattened alongside, plugin data kept on the block; repeater items
 * (`itemId`) the same, without `type`.
 */
export function normaliseValue(value: unknown, options: NormaliseOptions = {}): unknown {
  if (Array.isArray(value)) return value.map((entry) => normaliseValue(entry, options));
  if (!isRecord(value)) return value;
  if (isBlock(value)) return normaliseBlock(value, options);
  if (typeof value.itemId === 'string') return normaliseItem(value, options);
  // A block list; the grid is resolved here too, for the editor's stored shape.
  if (isBlocksValue(value)) {
    return {
      ...value,
      grid: value.grid ? resolveBlockGrid(value.grid as BlockGridValue) : null,
      blocks: value.blocks.map((entry) => normaliseValue(entry, options)),
    };
  }
  return value;
}

/** The blocks of a `blocks` field value, `{ grid, blocks }`. */
export function blocksOf<T extends Block = Block>(value: unknown): T[] {
  return isBlocksValue(value) ? (value.blocks as T[]) : [];
}

/** The grid of a `blocks` field value, or `null` for a plain list. */
export function gridOf(value: unknown): BlockGridSettings | null {
  if (!isBlocksValue(value) || !value.grid) return null;
  return resolveBlockGrid(value.grid as BlockGridValue);
}

function isBlocksValue(value: unknown): value is { grid?: unknown; blocks: unknown[] } {
  return isRecord(value) && Array.isArray(value.blocks) && !('blockId' in value);
}

export function normaliseFields(
  fields: Record<string, unknown>,
  options: NormaliseOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) out[name] = normaliseValue(value, options);
  return out;
}

function normaliseBlock(raw: Record<string, unknown>, options: NormaliseOptions): Block {
  const { blockId, typeName, type, fields, layout, __typename, ...rest } = raw;

  // REST keeps fields in `fields`, so any other key is plugin data (like `design`); GraphQL
  // sends both side by side, told apart by `blockExtensions`.
  const keys = isRecord(fields) ? null : (options.blockExtensions ?? DEFAULT_BLOCK_EXTENSIONS);
  const values: Record<string, unknown> = isRecord(fields) ? fields : {};
  const extensions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (!keys) extensions[key] = value;
    // GraphQL answers `null` where REST leaves the key out.
    else if (keys.includes(key)) {
      if (value !== null && value !== undefined) extensions[key] = value;
    } else values[key] = value;
  }
  const normalised = normaliseFields(values, options);

  const block: Block = {
    blockId: String(blockId),
    // REST sends `type`, GraphQL `typeName`; `__typename` is PascalCase, so never used.
    type: String(type ?? typeName ?? 'unknown'),
    ...normalised,
    ...extensions,
    fields: normalised,
  };
  if (isRecord(layout)) block.layout = layout as BlockLayout;
  return block;
}

function normaliseItem(raw: Record<string, unknown>, options: NormaliseOptions): FieldItem {
  const { itemId, fields, __typename, ...rest } = raw;
  const normalised = normaliseFields(isRecord(fields) ? { ...fields, ...rest } : rest, options);
  return { itemId: String(itemId), ...normalised, fields: normalised };
}

function isBlock(value: Record<string, unknown>): boolean {
  return typeof value.blockId === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
