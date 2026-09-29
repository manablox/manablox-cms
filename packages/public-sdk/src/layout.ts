import type {
  Block,
  BlockBreakpoint,
  BlockGrid,
  BlockGridSettings,
  BlockGridValue,
  BlockLayout,
  BlockPlacement,
} from './types.js';

/**
 * Grid layout for `blocks` fields via CSS custom properties that `BLOCK_GRID_CSS` reads
 * behind media queries. Include the stylesheet once, then:
 *
 *     <div class={GRID_CLASS} style={blocksGridStyle(value.grid)}>
 *       {value.blocks.map((block) => <Teaser class={BLOCK_CLASS} style={blockLayoutStyle(block, value.grid)} />)}
 *     </div>
 */

export const GRID_CLASS = 'manablox-grid';
export const BLOCK_CLASS = 'manablox-block';

/** Upper bounds, in CSS pixels, of the two narrower breakpoints. */
export const BREAKPOINT_MAX = { mobile: 639, tablet: 1023 } as const;

export const BLOCK_BREAKPOINTS: readonly BlockBreakpoint[] = ['desktop', 'tablet', 'mobile'];

/** The breakpoint a viewport width falls in. */
export function breakpointFor(width: number): BlockBreakpoint {
  if (width <= BREAKPOINT_MAX.mobile) return 'mobile';
  if (width <= BREAKPOINT_MAX.tablet) return 'tablet';
  return 'desktop';
}

/** The stylesheet the style helpers rely on. Include it once per page. */
export const BLOCK_GRID_CSS = `
.${GRID_CLASS}{display:grid;gap:var(--mb-gap,1rem);grid-template-columns:repeat(var(--mb-cols,1),minmax(0,1fr));grid-template-rows:var(--mb-rows,none)}
.${BLOCK_CLASS}{grid-column:var(--mb-col,auto);grid-row:var(--mb-row,auto);min-width:0}
@media (max-width:${BREAKPOINT_MAX.tablet}px){.${GRID_CLASS}{grid-template-columns:repeat(var(--mb-cols-md,1),minmax(0,1fr));grid-template-rows:var(--mb-rows-md,none)}.${BLOCK_CLASS}{grid-column:var(--mb-col-md,auto);grid-row:var(--mb-row-md,auto)}}
@media (max-width:${BREAKPOINT_MAX.mobile}px){.${GRID_CLASS}{grid-template-columns:repeat(var(--mb-cols-sm,1),minmax(0,1fr));grid-template-rows:var(--mb-rows-sm,none)}.${BLOCK_CLASS}{grid-column:var(--mb-col-sm,auto);grid-row:var(--mb-row-sm,auto)}}
`.trim();

const SUFFIX: Record<BlockBreakpoint, string> = { desktop: '', tablet: '-md', mobile: '-sm' };

/** A grid per breakpoint: tablet defaults to desktop, mobile to one column. */
export function resolveBlockGrid(
  grid: BlockGridValue | BlockGridSettings | null | undefined,
): BlockGridSettings {
  const desktop: BlockGrid = grid?.desktop ?? { columns: 1 };
  return {
    desktop,
    tablet: grid?.tablet ?? desktop,
    mobile: grid?.mobile ?? { columns: 1 },
  };
}

/** A grid with the same column count at every breakpoint. */
export function uniformGrid(columns: number, rows?: number): BlockGridSettings {
  const grid: BlockGrid = { columns: Math.max(1, columns), rows };
  return { desktop: grid, tablet: grid, mobile: grid };
}

/** The placement at a breakpoint: its own, else desktop's if the columns match, else auto. */
export function placementAt(
  layout: BlockLayout | null | undefined,
  breakpoint: BlockBreakpoint,
  grid?: BlockGridSettings,
): BlockPlacement | null {
  if (!layout) return null;
  if (breakpoint === 'desktop') return layout;
  const own = layout[breakpoint];
  if (own) return own;
  if (grid && grid[breakpoint].columns === grid.desktop.columns) return layout;
  return null;
}

/** Custom properties for the list's column and row templates per breakpoint. */
export function blocksGridStyle(
  gridOrBlocks:
    | BlockGridSettings
    | BlockGridValue
    | null
    | undefined
    | readonly (Block | BlockLayout | null | undefined)[],
  options: { gap?: string } = {},
): string {
  const grid = Array.isArray(gridOrBlocks)
    ? uniformGrid(columnsUsedBy(gridOrBlocks))
    : resolveBlockGrid(gridOrBlocks as BlockGridValue | null | undefined);
  const parts: string[] = [];
  for (const breakpoint of BLOCK_BREAKPOINTS) {
    const { columns, rows } = grid[breakpoint];
    parts.push(`--mb-cols${SUFFIX[breakpoint]}: ${Math.max(1, columns)}`);
    if (rows) parts.push(`--mb-rows${SUFFIX[breakpoint]}: repeat(${rows}, auto)`);
  }
  if (options.gap) parts.push(`--mb-gap: ${options.gap}`);
  return parts.join('; ');
}

/** Custom properties for a block's `grid-column` / `grid-row` per breakpoint. */
export function blockLayoutStyle(
  block: Block | BlockLayout | null | undefined,
  grid?: BlockGridSettings | BlockGridValue | null,
): string {
  const layout = isBlock(block) ? block.layout : block;
  if (!layout) return '';
  const resolved = grid ? resolveBlockGrid(grid) : undefined;
  const parts: string[] = [];
  for (const breakpoint of BLOCK_BREAKPOINTS) {
    const placement = placementAt(layout, breakpoint, resolved);
    if (!placement) continue;
    const column = gridTrack(placement.column, placement.columnSpan);
    const row = gridTrack(placement.row, placement.rowSpan);
    if (column) parts.push(`--mb-col${SUFFIX[breakpoint]}: ${column}`);
    if (row) parts.push(`--mb-row${SUFFIX[breakpoint]}: ${row}`);
  }
  return parts.join('; ');
}

/** The rightmost desktop column any block reaches, at least one. */
export function columnsUsedBy(blocks: readonly (Block | BlockLayout | null | undefined)[]): number {
  let columns = 1;
  for (const entry of blocks) {
    const layout = isBlock(entry) ? entry.layout : entry;
    if (!layout) continue;
    const end = (layout.column ?? 1) + (layout.columnSpan ?? 1) - 1;
    if (end > columns) columns = end;
  }
  return columns;
}

function gridTrack(start: number | undefined, span: number | undefined): string | null {
  const from = isLine(start) ? start : null;
  const length = isLine(span) && span > 1 ? span : null;
  if (from === null && length === null) return null;
  if (from === null) return `span ${length}`;
  return length === null ? String(from) : `${from} / span ${length}`;
}

function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isBlock(value: unknown): value is Block {
  return typeof value === 'object' && value !== null && 'blockId' in value;
}
