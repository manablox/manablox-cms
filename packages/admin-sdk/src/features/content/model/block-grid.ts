import type {
  BlockBreakpoint,
  BlockGridSettings,
  BlockGridValue,
  BlockLayout,
  BlockPlacement,
  BlocksValue,
  BlockValue,
} from '@manablox/core';
import { placementAt, resolveBlockGrid, blocksOf as sdkBlocksOf } from '@manablox/public-sdk';
import type { InjectionKey, Ref } from 'vue';

/** Editor-side block layout. Grid resolution rules come from the delivery SDK. */
export { placementAt, resolveBlockGrid };

/**
 * The blocks of a `blocks` value, stored as `{ grid, blocks }`. The cast
 * bridges the SDK's `layout: null` and the admin's `layout: undefined`.
 */
export function blocksOf(value: unknown): BlockValue[] {
  return sdkBlocksOf(value) as unknown as BlockValue[];
}
export const BREAKPOINTS: readonly {
  value: BlockBreakpoint;
  label: string;
  width: number | null;
  icon: string;
}[] = [
  { value: 'desktop', label: 'Desktop', width: null, icon: 'monitor' },
  { value: 'tablet', label: 'Tablet', width: 820, icon: 'tablet' },
  { value: 'mobile', label: 'Mobile', width: 390, icon: 'smartphone' },
];

/** The host's breakpoint; a blocks field inside uses it and hides its own switch. */
export const BOARD_BREAKPOINT: InjectionKey<Ref<BlockBreakpoint>> = Symbol('board-breakpoint');

/** The stored grid of a `blocks` value, if any. */
export function gridValueOf(value: unknown): BlockGridValue | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as { grid?: BlockGridValue }).grid ?? undefined;
}

/** A `blocks` value with these blocks, keeping the grid it had. */
export function withBlocks(value: unknown, blocks: BlockValue[]): BlocksValue {
  const grid = gridValueOf(value);
  return grid ? { grid, blocks } : { blocks };
}

export function isBlockGrid(grid: BlockGridSettings): boolean {
  return grid.desktop.columns > 1 || grid.tablet.columns > 1 || grid.mobile.columns > 1;
}

/** Whether a breakpoint carries its own placement rather than following desktop. */
export function hasOwnPlacement(layout: BlockLayout | undefined, breakpoint: BlockBreakpoint) {
  if (!layout) return false;
  return breakpoint === 'desktop' ? hasPlacement(layout) : layout[breakpoint] !== undefined;
}

function hasPlacement(placement: BlockPlacement): boolean {
  return (
    placement.column !== undefined ||
    placement.row !== undefined ||
    placement.columnSpan !== undefined ||
    placement.rowSpan !== undefined
  );
}

/** The layout with one breakpoint's placement replaced, or removed with `null`. */
export function withPlacement(
  layout: BlockLayout | undefined,
  breakpoint: BlockBreakpoint,
  placement: BlockPlacement | null,
): BlockLayout | undefined {
  const { column: _c, row: _r, columnSpan: _cs, rowSpan: _rs, ...rest } = layout ?? {};
  const next: BlockLayout =
    breakpoint === 'desktop'
      ? { ...rest, ...(placement ?? {}) }
      : { ...(layout ?? {}), [breakpoint]: placement ?? undefined };
  if (breakpoint !== 'desktop' && placement === null) delete next[breakpoint];
  const empty = !hasPlacement(next) && next.tablet === undefined && next.mobile === undefined;
  return empty ? undefined : next;
}

export interface BoardCell {
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

/** Where every block lands at a breakpoint, mimicking CSS grid auto-placement. */
export function placeBlocks(
  blocks: readonly BlockValue[],
  breakpoint: BlockBreakpoint,
  grid: BlockGridSettings,
): Map<string, BoardCell & { auto: boolean }> {
  const columns = Math.max(1, grid[breakpoint].columns);
  const out = new Map<string, BoardCell & { auto: boolean }>();
  const taken = new Set<string>();
  const key = (column: number, row: number) => `${column}:${row}`;
  const occupy = (cell: BoardCell) => {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
      for (let c = cell.column; c < cell.column + cell.columnSpan; c += 1) taken.add(key(c, r));
    }
  };

  const pending: BlockValue[] = [];
  for (const block of blocks) {
    const placement = placementAt(block.layout, breakpoint, grid);
    if (!placement || placement.column === undefined || placement.row === undefined) {
      pending.push(block);
      continue;
    }
    const cell = {
      column: Math.min(placement.column, columns),
      row: placement.row,
      columnSpan: Math.max(1, Math.min(placement.columnSpan ?? 1, columns - placement.column + 1)),
      rowSpan: Math.max(1, placement.rowSpan ?? 1),
    };
    out.set(block.blockId, { ...cell, auto: false });
    occupy(cell);
  }

  let cursor = { column: 1, row: 1 };
  for (const block of pending) {
    const placement = placementAt(block.layout, breakpoint, grid);
    const columnSpan = Math.max(1, Math.min(placement?.columnSpan ?? 1, columns));
    const rowSpan = Math.max(1, placement?.rowSpan ?? 1);
    let found: BoardCell | null = null;
    for (let row = cursor.row; !found && row < cursor.row + 500; row += 1) {
      for (
        let column = row === cursor.row ? cursor.column : 1;
        column <= columns - columnSpan + 1;
        column += 1
      ) {
        let free = true;
        for (let r = row; free && r < row + rowSpan; r += 1) {
          for (let c = column; c < column + columnSpan; c += 1) {
            if (taken.has(key(c, r))) {
              free = false;
              break;
            }
          }
        }
        if (free) {
          found = { column, row, columnSpan, rowSpan };
          break;
        }
      }
    }
    const cell = found ?? { column: 1, row: cursor.row + 1, columnSpan, rowSpan };
    out.set(block.blockId, { ...cell, auto: true });
    occupy(cell);
    cursor = { column: cell.column + cell.columnSpan, row: cell.row };
    if (cursor.column > columns) cursor = { column: 1, row: cell.row + 1 };
  }
  return out;
}
