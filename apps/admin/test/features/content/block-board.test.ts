import type { BoardCell } from '@manablox/admin-sdk/features/content/model/block-grid';
import { describe, expect, it } from 'vitest';
import {
  boardCells,
  cellKey,
  clampPlacement,
  drawnRectangle,
  gridArea,
  matchesDesktop,
  movedTo,
  occupiedCells,
  resizedTo,
  sameCell,
  stepperRange,
  visibleRows,
} from '~/features/content/model/block-board';

/** The board's pointer geometry. */

const cell = (column: number, row: number, columnSpan = 1, rowSpan = 1): BoardCell => ({
  column,
  row,
  columnSpan,
  rowSpan,
});

const GRID = { columns: 4 };
const FIXED = { columns: 4, fixedRows: 3 };

describe('the ground', () => {
  it('knows every cell a block covers', () => {
    const taken = occupiedCells([cell(2, 1, 2, 2)]);
    expect([...taken].sort()).toEqual(['2:1', '2:2', '3:1', '3:2']);
    expect(taken.has(cellKey(1, 1))).toBe(false);
  });

  it('draws one row past the last block, and two where a block can be drawn', () => {
    expect(visibleRows([cell(1, 2, 1, 2)], {})).toBe(4);
    expect(visibleRows([cell(1, 2, 1, 2)], { insertable: true })).toBe(5);
    // An empty board still has somewhere to draw.
    expect(visibleRows([], {})).toBe(2);
    expect(visibleRows([], { insertable: true })).toBe(3);
    // A fixed grid keeps its height however far a block reaches.
    expect(visibleRows([cell(1, 9)], { fixedRows: 3, insertable: true })).toBe(3);
  });

  it('lays the cells out in reading order', () => {
    expect(boardCells(2, 2)).toEqual([
      { column: 1, row: 1 },
      { column: 2, row: 1 },
      { column: 1, row: 2 },
      { column: 2, row: 2 },
    ]);
  });
});

describe('a block put somewhere', () => {
  it('stays on the grid', () => {
    // Wider than the board: cut to it.
    expect(clampPlacement(cell(1, 1, 9, 1), GRID)).toMatchObject({ column: 1, columnSpan: 4 });
    // Dragged past the last column: held where it still fits.
    expect(clampPlacement(cell(9, 1, 2, 1), GRID)).toMatchObject({ column: 3, columnSpan: 2 });
    expect(clampPlacement(cell(0, 0, 1, 1), GRID)).toMatchObject({ column: 1, row: 1 });
  });

  it('may go down forever on a grid that grows, and not on one that does not', () => {
    expect(clampPlacement(cell(1, 9), GRID).row).toBe(9);
    expect(clampPlacement(cell(1, 9), FIXED).row).toBe(3);
    expect(clampPlacement(cell(1, 1, 1, 9), FIXED).rowSpan).toBe(3);
    expect(clampPlacement(cell(1, 1, 1, 9), GRID).rowSpan).toBe(9);
    // Two rows tall on a three-row grid can start on the second row, not the third.
    expect(clampPlacement(cell(1, 3, 1, 2), FIXED).row).toBe(2);
  });
});

describe('dragging a block', () => {
  it('carries it by the cells the pointer crossed, not to the cell under it', () => {
    // Held near its right end and dragged one cell: it moves one cell.
    const moved = movedTo(cell(1, 1, 3, 1), { column: 3, row: 1 }, { column: 4, row: 1 });
    expect(moved).toEqual(cell(2, 1, 3, 1));
  });

  it('moves the side that was grabbed, and only that side', () => {
    const block = cell(2, 2, 2, 2);
    expect(resizedTo(block, { column: 4, row: 3 }, { x: 'east', y: null })).toEqual(
      cell(2, 2, 3, 2),
    );
    expect(resizedTo(block, { column: 4, row: 4 }, { x: null, y: 'south' })).toEqual(
      cell(2, 2, 2, 3),
    );
    // Dragging the west edge left keeps the right edge put.
    expect(resizedTo(block, { column: 1, row: 1 }, { x: 'west', y: null })).toEqual(
      cell(1, 2, 3, 2),
    );
    expect(resizedTo(block, { column: 1, row: 1 }, { x: 'west', y: 'north' })).toEqual(
      cell(1, 1, 3, 3),
    );
  });

  it('never turns a block inside out', () => {
    const block = cell(2, 2, 2, 2);
    // The west edge stops at one column wide.
    expect(resizedTo(block, { column: 9, row: 9 }, { x: 'west', y: 'north' })).toEqual(
      cell(3, 3, 1, 1),
    );
    expect(resizedTo(block, { column: 0, row: 0 }, { x: 'east', y: 'south' })).toEqual(
      cell(2, 2, 1, 1),
    );
  });

  it('recognises the drag that changed nothing', () => {
    expect(sameCell(cell(1, 1, 2, 2), cell(1, 1, 2, 2))).toBe(true);
    expect(sameCell(cell(1, 1, 2, 2), cell(1, 1, 2, 3))).toBe(false);
  });
});

describe('drawing on empty ground', () => {
  const occupied = occupiedCells([cell(3, 1, 1, 3)]);

  it('grows from the cell the press began in', () => {
    expect(drawnRectangle({ column: 1, row: 1 }, { column: 2, row: 2 }, new Set())).toEqual(
      cell(1, 1, 2, 2),
    );
  });

  it('grows backwards as readily as forwards', () => {
    expect(drawnRectangle({ column: 3, row: 3 }, { column: 1, row: 1 }, new Set())).toEqual(
      cell(1, 1, 3, 3),
    );
  });

  it('stops short of a block rather than covering it', () => {
    // Column 3 is taken for its whole height, so the rectangle ends at column 2.
    expect(drawnRectangle({ column: 1, row: 1 }, { column: 4, row: 1 }, occupied)).toEqual(
      cell(1, 1, 2, 1),
    );
  });

  it('settles its columns before its rows, so what is drawn is always free', () => {
    // Column 3 is outside the rectangle, so it grows through both rows.
    expect(drawnRectangle({ column: 1, row: 1 }, { column: 4, row: 3 }, occupied)).toEqual(
      cell(1, 1, 2, 3),
    );
    // Beside the taken column, the rows stop first.
    const blocked = occupiedCells([cell(2, 2, 1, 1)]);
    expect(drawnRectangle({ column: 1, row: 1 }, { column: 2, row: 3 }, blocked)).toEqual(
      cell(1, 1, 2, 1),
    );
  });
});

describe('the steppers', () => {
  it('let a block move as far as it fits and no further', () => {
    const block = cell(2, 2, 2, 2);
    expect(stepperRange('column', block, GRID)).toEqual({ min: 1, max: 3 });
    expect(stepperRange('columnSpan', block, GRID)).toEqual({ min: 1, max: 3 });
    expect(stepperRange('row', block, FIXED)).toEqual({ min: 1, max: 2 });
    expect(stepperRange('rowSpan', block, FIXED)).toEqual({ min: 1, max: 2 });
  });

  it('have no last row on a grid that grows', () => {
    expect(stepperRange('row', cell(1, 1), GRID).max).toBe(Number.POSITIVE_INFINITY);
    expect(stepperRange('rowSpan', cell(1, 1), GRID).max).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the rest', () => {
  it('writes a cell as the grid properties that place it', () => {
    expect(gridArea(cell(2, 3, 2, 1))).toEqual({
      gridColumn: '2 / span 2',
      gridRow: '3 / span 1',
    });
  });

  it('says a breakpoint may follow desktop only on an equal grid', () => {
    const grid = {
      desktop: { columns: 4 },
      tablet: { columns: 4 },
      mobile: { columns: 1 },
    } as never;
    expect(matchesDesktop(grid, 'tablet')).toBe(true);
    expect(matchesDesktop(grid, 'mobile')).toBe(false);
    expect(matchesDesktop(grid, 'desktop')).toBe(false);
  });
});
