import {
  type BlockGridSettings,
  type BlockGridValue,
  isBlockGrid,
  resolveBlockGrid,
} from '@manablox/core';

/** A `blocks` value's grid, or `null` for a plain list. */
export function blockGridOf(value: unknown): BlockGridSettings | null {
  const raw = (value as { grid?: BlockGridValue } | null | undefined)?.grid;
  if (!raw) return null;
  const grid = resolveBlockGrid(raw);
  return isBlockGrid(grid) ? grid : null;
}
