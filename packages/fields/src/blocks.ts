import {
  BLOCK_BREAKPOINTS,
  type BlockGrid,
  type BlockGridValue,
  type BlockLayout,
  type BlockPlacement,
  type BlocksValue,
  type BlockValue,
  defineFieldType,
  type FieldValueContext,
  isBlockGrid,
  resolveBlockGrid,
} from '@manablox/core';
import { z } from 'zod';

export { isBlockGrid, resolveBlockGrid };

/** Matches the common 12-column CSS grid. */
export const MAX_GRID_COLUMNS = 12;
export const MAX_GRID_ROWS = 100;

const gridLine = z.number().int().positive();

const placementShape = {
  column: gridLine.optional(),
  row: gridLine.optional(),
  columnSpan: gridLine.optional(),
  rowSpan: gridLine.optional(),
};

export const blockPlacement: z.ZodType<BlockPlacement> = z.object(placementShape);

export const blockLayout: z.ZodType<BlockLayout> = z.object({
  ...placementShape,
  tablet: blockPlacement.optional(),
  mobile: blockPlacement.optional(),
});

type BlockExtensions = NonNullable<FieldValueContext['blockExtensions']>;

const blockShape = {
  blockId: z.string().uuid(),
  /** Content type id of a `kind: 'block'` type. */
  type: z.string().uuid(),
  /** Keyed by field name; validated recursively by the service. */
  fields: z.record(z.string(), z.unknown()),
  /** Only on grid fields. */
  layout: blockLayout.optional(),
  /** Plugin data by plugin id. */
  ext: z.record(z.string(), z.unknown()).optional(),
};

const NO_EXTENSIONS: BlockExtensions = new Map();
const blockSchemas = new WeakMap<BlockExtensions, z.ZodType<BlockValue>>();

/**
 * A block whose `ext` entries are checked by the plugins on for the space; entries of other
 * plugins are dropped, the rest stored as the plugin strips them, an empty `ext` left out.
 */
function blockValueOf(context: FieldValueContext): z.ZodType<BlockValue> {
  const checks = context.blockExtensions ?? NO_EXTENSIONS;
  const cached = blockSchemas.get(checks);
  if (cached) return cached;
  const schema = z
    .object(blockShape)
    .superRefine((block, ctx) => {
      for (const [id, value] of Object.entries(block.ext ?? {})) {
        const check = checks.get(id);
        if (!check) continue;
        const issues = check.validate(value, {
          type: block.type,
          spaceId: context.spaceId,
          locale: context.locale,
        });
        for (const issue of issues) {
          ctx.addIssue({
            code: 'custom',
            message: issue.message,
            path: ['ext', id, ...(issue.path ?? [])],
          });
        }
      }
    })
    .transform(({ ext, ...block }): BlockValue => {
      const kept: Record<string, unknown> = {};
      for (const [id, value] of Object.entries(ext ?? {})) {
        const check = checks.get(id);
        if (!check) continue;
        const stored = check.strip ? check.strip(value) : value;
        if (stored !== undefined) kept[id] = stored;
      }
      return Object.keys(kept).length ? { ...block, ext: kept } : block;
    });
  blockSchemas.set(checks, schema);
  return schema;
}

export const blockSettings = z.object({
  /** The single block type this field holds. */
  type: z.string().uuid(),
});

export type BlockSettings = z.infer<typeof blockSettings>;

export const blockField = defineFieldType<BlockSettings, BlockValue | null>({
  name: 'block',
  label: 'Block',
  icon: 'i-lucide-square',
  nested: true,

  settingsSchema: blockSettings,
  valueSchema: (_settings, context) => blockValueOf(context).nullable(),
  defaultValue: () => null,
  storage: { kind: 'jsonb', index: false },
  filters: ['isNull', 'isNotNull'],
  graphql: { type: { kind: 'block' } },
  blocks: (value) => (value ? [value] : []),

  admin: { input: 'block', settings: 'block' },
});

const blockGrid: z.ZodType<BlockGrid> = z.object({
  columns: z.number().int().min(1).max(MAX_GRID_COLUMNS),
  rows: z.number().int().min(1).max(MAX_GRID_ROWS).optional(),
});

export const blockGridValue: z.ZodType<BlockGridValue> = z.object({
  desktop: blockGrid.optional(),
  tablet: blockGrid.optional(),
  mobile: blockGrid.optional(),
});

/** `{ grid, blocks }`; without `grid` a plain list. */
const blocksValueOf = (context: FieldValueContext): z.ZodType<BlocksValue, unknown> =>
  z.object({ grid: blockGridValue.optional(), blocks: z.array(blockValueOf(context)) });

export const blocksSettings = z.object({
  /** Allowed block types. Empty means all. */
  types: z.array(z.string().uuid()).default([]),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
});

export type BlocksSettings = z.infer<typeof blocksSettings>;

/** An ordered list of blocks: the page-builder field. */
export const blocksField = defineFieldType<BlocksSettings, BlocksValue>({
  name: 'blocks',
  label: 'Blocks',
  icon: 'i-lucide-layout-list',
  nested: true,

  settingsSchema: blocksSettings,

  valueSchema: (settings, context) =>
    blocksValueOf(context).superRefine((value, ctx) => {
      if (settings.min !== undefined && value.blocks.length < settings.min) {
        ctx.addIssue({
          code: 'custom',
          message: `At least ${settings.min} blocks.`,
          path: ['blocks'],
        });
      }
      if (settings.max !== undefined && value.blocks.length > settings.max) {
        ctx.addIssue({
          code: 'custom',
          message: `At most ${settings.max} blocks.`,
          path: ['blocks'],
        });
      }
      value.blocks.forEach((block, index) => {
        const issue = layoutIssue(block.layout, value.grid);
        if (issue) ctx.addIssue({ code: 'custom', message: issue, path: [index, 'layout'] });
      });
    }),

  defaultValue: () => ({ blocks: [] }),
  isEmpty: (value) => Array.isArray(value?.blocks) && value.blocks.length === 0,
  storage: { kind: 'jsonb', index: false },
  filters: ['isNull', 'isNotNull'],
  graphql: { type: { kind: 'block' }, list: true },
  blocks: (value) => value?.blocks ?? [],

  admin: { input: 'blocks', settings: 'blocks' },
});

/** Why a layout does not fit the grid, or `null`. A plain list accepts no layout. */
export function layoutIssue(
  layout: BlockLayout | undefined,
  gridValue: BlockGridValue | null | undefined,
): string | null {
  if (!layout) return null;
  const grid = resolveBlockGrid(gridValue);
  if (!isBlockGrid(grid)) return 'A block in a single-column list has no layout.';
  for (const breakpoint of BLOCK_BREAKPOINTS) {
    const placement = breakpoint === 'desktop' ? layout : layout[breakpoint];
    if (!placement) continue;
    const { columns, rows } = grid[breakpoint];
    const column = placement.column ?? 1;
    const columnSpan = placement.columnSpan ?? 1;
    if (column + columnSpan - 1 > columns) {
      return `The block reaches past column ${columns} on ${breakpoint}.`;
    }
    if (rows !== undefined) {
      const row = placement.row ?? 1;
      const rowSpan = placement.rowSpan ?? 1;
      if (row + rowSpan - 1 > rows) return `The block reaches past row ${rows} on ${breakpoint}.`;
    }
  }
  return null;
}
