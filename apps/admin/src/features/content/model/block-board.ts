import type { BoardCell } from '@manablox/admin-sdk/features/content/model/block-grid';
import type { BlockGridSettings, BlockPlacement } from '@manablox/core';

/** Block board geometry for `BlockGridBoard.vue`, kept pure so it is testable. */

/** A single board cell, e.g. under the pointer. */
export interface BoardPoint {
  column: number;
  row: number;
}

/** Which sides of a block a drag is moving. Both null moves the whole block. */
export interface BoardEdges {
  x: 'west' | 'east' | null;
  y: 'north' | 'south' | null;
}

export interface BoardBounds {
  columns: number;
  /** Unset means the grid grows downwards. */
  fixedRows?: number | undefined;
}

export function cellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

/** `column:row` of every covered cell. */
export function occupiedCells(placed: Iterable<BoardCell>): Set<string> {
  const taken = new Set<string>();
  for (const cell of placed) {
    for (let r = cell.row; r < cell.row + cell.rowSpan; r += 1) {
      for (let c = cell.column; c < cell.column + cell.columnSpan; c += 1) {
        taken.add(cellKey(c, r));
      }
    }
  }
  return taken;
}

/** Rows to draw: the fixed count, else the last block plus one spare (two if insertable). */
export function visibleRows(
  placed: Iterable<BoardCell>,
  options: { fixedRows?: number | undefined; insertable?: boolean },
): number {
  if (options.fixedRows) return options.fixedRows;
  let last = 1;
  for (const cell of placed) last = Math.max(last, cell.row + cell.rowSpan - 1);
  const spare = options.insertable ? 2 : 1;
  return Math.max(spare + 1, last + spare);
}

/** Every cell of the board, in reading order. */
export function boardCells(columns: number, rows: number): BoardPoint[] {
  const out: BoardPoint[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) out.push({ column, row });
  }
  return out;
}

/** Clamps a cell onto the board. */
export function clampPlacement(cell: BoardCell, bounds: BoardBounds): BlockPlacement {
  const columnSpan = clamp(cell.columnSpan, 1, bounds.columns);
  const rowSpan = bounds.fixedRows
    ? clamp(cell.rowSpan, 1, bounds.fixedRows)
    : Math.max(1, cell.rowSpan);
  return {
    column: clamp(cell.column, 1, bounds.columns - columnSpan + 1),
    row: bounds.fixedRows
      ? clamp(cell.row, 1, bounds.fixedRows - rowSpan + 1)
      : Math.max(1, cell.row),
    columnSpan,
    rowSpan,
  };
}

/** The block shifted by the pointer's movement since the drag began. */
export function movedTo(origin: BoardCell, from: BoardPoint, to: BoardPoint): BoardCell {
  return {
    ...origin,
    column: origin.column + (to.column - from.column),
    row: origin.row + (to.row - from.row),
  };
}

/** The block with its dragged sides moved to the pointer's cell. */
export function resizedTo(cell: BoardCell, pointer: BoardPoint, edges: BoardEdges): BoardCell {
  const right = cell.column + cell.columnSpan - 1;
  const bottom = cell.row + cell.rowSpan - 1;
  let { column, row, columnSpan, rowSpan } = cell;

  if (edges.x === 'east') columnSpan = Math.max(1, pointer.column - column + 1);
  if (edges.x === 'west') {
    column = Math.max(1, Math.min(pointer.column, right));
    columnSpan = right - column + 1;
  }
  if (edges.y === 'south') rowSpan = Math.max(1, pointer.row - row + 1);
  if (edges.y === 'north') {
    row = Math.max(1, Math.min(pointer.row, bottom));
    rowSpan = bottom - row + 1;
  }
  return { column, row, columnSpan, rowSpan };
}

/** The rectangle drawn from `origin` towards the pointer, stopping before occupied cells. */
export function drawnRectangle(
  origin: BoardPoint,
  pointer: BoardPoint,
  occupied: ReadonlySet<string>,
): BoardCell {
  // Columns first, then rows across the chosen columns.
  const [left, right] = reach(
    origin.column,
    pointer.column,
    (column) => !occupied.has(cellKey(column, origin.row)),
  );
  const [top, bottom] = reach(origin.row, pointer.row, (row) => {
    for (let column = left; column <= right; column += 1) {
      if (occupied.has(cellKey(column, row))) return false;
    }
    return true;
  });
  return { column: left, row: top, columnSpan: right - left + 1, rowSpan: bottom - top + 1 };
}

/** How far to grow from `origin` towards `to` while cells are free. */
function reach(origin: number, to: number, free: (value: number) => boolean): [number, number] {
  const step = to >= origin ? 1 : -1;
  let last = origin;
  for (let value = origin + step; step > 0 ? value <= to : value >= to; value += step) {
    if (!free(value)) break;
    last = value;
  }
  return step > 0 ? [origin, last] : [last, origin];
}

export function sameCell(a: BoardCell, b: BoardCell): boolean {
  return (
    a.column === b.column &&
    a.row === b.row &&
    a.columnSpan === b.columnSpan &&
    a.rowSpan === b.rowSpan
  );
}

/** A cell as CSS grid placement. */
export function gridArea(cell: BoardCell): { gridColumn: string; gridRow: string } {
  return {
    gridColumn: `${cell.column} / span ${cell.columnSpan}`,
    gridRow: `${cell.row} / span ${cell.rowSpan}`,
  };
}

/** The stepper range for one placement number; rows are unbounded on a growing grid. */
export function stepperRange(
  key: keyof BoardCell,
  cell: BoardCell,
  bounds: BoardBounds,
): { min: number; max: number } {
  switch (key) {
    case 'column':
      return { min: 1, max: bounds.columns - cell.columnSpan + 1 };
    case 'columnSpan':
      return { min: 1, max: bounds.columns - cell.column + 1 };
    case 'row':
      return {
        min: 1,
        max: bounds.fixedRows ? bounds.fixedRows - cell.rowSpan + 1 : Number.POSITIVE_INFINITY,
      };
    case 'rowSpan':
      return {
        min: 1,
        max: bounds.fixedRows ? bounds.fixedRows - cell.row + 1 : Number.POSITIVE_INFINITY,
      };
  }
}

/** Whether a breakpoint has desktop's column count, so blocks may follow desktop. */
export function matchesDesktop(grid: BlockGridSettings, breakpoint: keyof BlockGridSettings) {
  return breakpoint !== 'desktop' && grid[breakpoint].columns === grid.desktop.columns;
}

/** A block card's resize handles, always present so a block can be resized without selecting it first. */
export const BOARD_HANDLES: readonly (BoardEdges & { id: string; label: string; class: string })[] =
  [
    {
      id: 'n',
      x: null,
      y: 'north',
      label: 'top edge',
      class: 'inset-x-1.5 top-0 h-1.5 cursor-row-resize',
    },
    {
      id: 's',
      x: null,
      y: 'south',
      label: 'bottom edge',
      class: 'inset-x-1.5 bottom-0 h-1.5 cursor-row-resize',
    },
    {
      id: 'w',
      x: 'west',
      y: null,
      label: 'left edge',
      class: 'inset-y-1.5 left-0 w-1.5 cursor-col-resize',
    },
    {
      id: 'e',
      x: 'east',
      y: null,
      label: 'right edge',
      class: 'inset-y-1.5 right-0 w-1.5 cursor-col-resize',
    },
    {
      id: 'nw',
      x: 'west',
      y: 'north',
      label: 'top left corner',
      class: 'top-0 left-0 h-2.5 w-2.5 cursor-nwse-resize',
    },
    {
      id: 'ne',
      x: 'east',
      y: 'north',
      label: 'top right corner',
      class: 'top-0 right-0 h-2.5 w-2.5 cursor-nesw-resize',
    },
    {
      id: 'sw',
      x: 'west',
      y: 'south',
      label: 'bottom left corner',
      class: 'bottom-0 left-0 h-2.5 w-2.5 cursor-nesw-resize',
    },
    {
      id: 'se',
      x: 'east',
      y: 'south',
      label: 'bottom right corner',
      class: 'bottom-0 right-0 h-2.5 w-2.5 cursor-nwse-resize',
    },
  ];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
