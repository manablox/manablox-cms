import { describe, expect, it } from 'vitest';
import {
  BLOCK_GRID_CSS,
  blockLayoutStyle,
  blocksGridStyle,
  breakpointFor,
  columnsUsedBy,
  placementAt,
  resolveBlockGrid,
  uniformGrid,
} from '../src/layout.js';
import { blocksOf, gridOf, normaliseValue } from '../src/normalise.js';
import type { Block } from '../src/types.js';

const block = (layout?: Block['layout']): Block => ({
  blockId: crypto.randomUUID(),
  type: 'teaser',
  fields: {},
  ...(layout ? { layout } : {}),
});

describe('block layout styles', () => {
  const grid = resolveBlockGrid({ desktop: { columns: 3 }, tablet: { columns: 2 } });

  it('writes a placement per breakpoint', () => {
    const style = blockLayoutStyle(
      block({
        column: 2,
        columnSpan: 2,
        row: 1,
        tablet: { column: 1, columnSpan: 2 },
        mobile: { row: 3 },
      }),
      grid,
    );
    expect(style).toBe(
      '--mb-col: 2 / span 2; --mb-row: 1; --mb-col-md: 1 / span 2; --mb-row-sm: 3',
    );
  });

  it('lets tablet follow desktop only when the grids match', () => {
    const layout = { column: 2, columnSpan: 2 };
    expect(placementAt(layout, 'tablet', resolveBlockGrid({ desktop: { columns: 3 } }))).toBe(
      layout,
    );
    expect(placementAt(layout, 'tablet', grid)).toBeNull();
    expect(placementAt(layout, 'mobile', resolveBlockGrid({ desktop: { columns: 3 } }))).toBeNull();
    expect(blockLayoutStyle(block(layout), { desktop: { columns: 3 } })).toBe(
      '--mb-col: 2 / span 2; --mb-col-md: 2 / span 2',
    );
  });

  it('leaves an unplaced block to the grid', () => {
    expect(blockLayoutStyle(block(), grid)).toBe('');
    expect(blockLayoutStyle(null)).toBe('');
    expect(blockLayoutStyle({ column: 0, columnSpan: 1 })).toBe('');
  });

  it('sizes the grid from the settings, or from the blocks', () => {
    expect(
      blocksGridStyle(
        { desktop: { columns: 4, rows: 2 }, tablet: { columns: 2 } },
        { gap: '2rem' },
      ),
    ).toBe(
      '--mb-cols: 4; --mb-rows: repeat(2, auto); --mb-cols-md: 2; --mb-cols-sm: 1; --mb-gap: 2rem',
    );
    const blocks = [block({ column: 1 }), block({ column: 2, columnSpan: 2 })];
    expect(columnsUsedBy(blocks)).toBe(3);
    expect(blocksGridStyle(blocks)).toBe('--mb-cols: 3; --mb-cols-md: 3; --mb-cols-sm: 3');
    expect(uniformGrid(0).desktop.columns).toBe(1);
  });

  it('resolves grids and breakpoints the way the server does', () => {
    expect(resolveBlockGrid({ desktop: { columns: 3, rows: 2 } })).toEqual({
      desktop: { columns: 3, rows: 2 },
      tablet: { columns: 3, rows: 2 },
      mobile: { columns: 1 },
    });
    expect(blocksGridStyle(null)).toBe('--mb-cols: 1; --mb-cols-md: 1; --mb-cols-sm: 1');
    expect(breakpointFor(390)).toBe('mobile');
    expect(breakpointFor(820)).toBe('tablet');
    expect(breakpointFor(1280)).toBe('desktop');
    expect(BLOCK_GRID_CSS).toContain('@media (max-width:1023px)');
    expect(BLOCK_GRID_CSS).toContain('--mb-col-sm');
  });
});

describe('layout through normalisation', () => {
  it('keeps a block list as grid plus blocks, resolving a stored grid', () => {
    const raw = {
      grid: { desktop: { columns: 3 } },
      blocks: [{ blockId: 'b1', type: 'teaser', fields: { headline: 'Hi' } }],
    };
    const value = normaliseValue(raw) as { grid: { tablet: { columns: number } }; blocks: Block[] };
    expect(value.grid.tablet.columns).toBe(3);
    expect(value.blocks[0]?.headline).toBe('Hi');
    expect(blocksOf(raw)).toHaveLength(1);
    expect(blocksOf(raw.blocks)).toEqual([]);
    expect(gridOf({ blocks: [] })).toBeNull();
    expect(gridOf(raw)?.mobile.columns).toBe(1);
  });

  it('stays on the block rather than becoming a field', () => {
    const raw = {
      blockId: 'b1',
      type: 'teaser',
      fields: { headline: 'Hi' },
      layout: { column: 2 },
    };
    const result = normaliseValue(raw) as Block;
    expect(result.layout).toEqual({ column: 2 });
    expect(result.fields).toEqual({ headline: 'Hi' });
    expect(result.headline).toBe('Hi');
  });

  it('survives the GraphQL shape too', () => {
    const raw = {
      blockId: 'b1',
      typeName: 'teaser',
      __typename: 'Teaser',
      headline: 'Hi',
      layout: null,
    };
    const result = normaliseValue(raw) as Block;
    expect(result.layout).toBeUndefined();
    expect(result.fields).toEqual({ headline: 'Hi' });
  });
});
