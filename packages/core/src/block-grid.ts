import {
  BLOCK_BREAKPOINTS,
  type BlockGrid,
  type BlockGridSettings,
  type BlockGridValue,
} from './types.js';

/** Tablet defaults to desktop, mobile to one column. */
export function resolveBlockGrid(grid: BlockGridValue | null | undefined): BlockGridSettings {
  const desktop: BlockGrid = grid?.desktop ?? { columns: 1 };
  return {
    desktop,
    tablet: grid?.tablet ?? desktop,
    mobile: grid?.mobile ?? { columns: 1 },
  };
}

/** Whether any breakpoint has more than one column. */
export function isBlockGrid(grid: BlockGridSettings): boolean {
  return BLOCK_BREAKPOINTS.some((breakpoint) => grid[breakpoint].columns > 1);
}
