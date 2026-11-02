import {
  BLOCK_CLASS,
  type BlockGridSettings,
  blockLayoutStyle,
  blocksGridStyle,
  blocksOf,
  columnsUsedBy,
  GRID_CLASS,
  gridOf,
  uniformGrid,
} from '@manablox/public-sdk';
import {
  type DataElement,
  type DesignNode,
  type InstanceStyle,
  instanceClass,
  normalizeInstanceStyle,
} from '@manablox/site';
import { h, type VNodeChild } from 'vue';
import { itemFields, resolveBinding } from '../bindings.js';
import {
  blockDesignFor,
  type Frame,
  fieldDefs,
  type RenderContext,
  type RepeatFrame,
  subFieldDefs,
  variantRoot,
} from '../context.js';
import { fieldMarker, listMarker } from '../markers.js';
import type { ElementRenderer, NodeExtra, renderNode } from '../renderer.js';
import type { MarkerPath } from '../types.js';
import { isRecord } from '../util.js';
import { empty } from './shared.js';

/** Attribute on a block's root naming its type, for the canvas. */
export const BLOCK_ATTRIBUTE = 'data-mb-block';

interface BlockLike {
  blockId?: unknown;
  type?: unknown;
  typeName?: unknown;
  fields?: unknown;
  layout?: unknown;
  design?: unknown;
  ext?: unknown;
}

/** Whether a block's design shows at all: its type is known or the canvas needs a placeholder. */
function blockTypeOf(ctx: RenderContext, block: BlockLike) {
  const name = typeof block.type === 'string' ? block.type : block.typeName;
  return typeof name === 'string' ? (ctx.types.get(name) ?? null) : null;
}

/** The block's design: delivered as `design`, stored at `ext.website` in editor drafts. */
function instanceDesignOf(block: BlockLike): Record<string, unknown> | null {
  if (isRecord(block.design)) return block.design;
  return isRecord(block.ext) && isRecord(block.ext.website) ? block.ext.website : null;
}

function instanceStyleOf(block: BlockLike): InstanceStyle | null {
  const design = instanceDesignOf(block);
  return design ? normalizeInstanceStyle(design.style as InstanceStyle) : null;
}

export interface BlockPlacement {
  render: typeof renderNode;
  path: MarkerPath | null;
  /** Variant when the block does not pick one. */
  variant?: string | null | undefined;
  extra?: NodeExtra;
}

/** One block through its type's design (stored or generated) and variant. */
export function renderBlock(
  block: unknown,
  ctx: RenderContext,
  placement: BlockPlacement,
): VNodeChild {
  if (!isRecord(block)) return null;
  const value = block as BlockLike;
  const type = blockTypeOf(ctx, value);
  const design = type ? blockDesignFor(ctx, type.id) : null;
  const variant = instanceDesignOf(value)?.variant;
  const picked = typeof variant === 'string' ? variant : null;
  const root = design ? variantRoot(design, picked ?? placement.variant) : null;
  const extra = placement.extra ?? {};
  if (!type || !root) {
    return ctx.canvas
      ? h('div', {
          class: extra.class,
          style: extra.style,
          ...extra.attrs,
          'data-mb-empty': 'Unknown block',
        })
      : null;
  }

  const style = instanceStyleOf(value);
  const instance = instanceClass(style);
  if (style && instance) ctx.instanceStyles.set(instance, style);

  const frame: Frame = {
    kind: 'block',
    key: type.id,
    data: {
      fields: itemFields(value),
      defs: fieldDefs(type),
      path: placement.path,
      repeats: new Map(),
      document: false,
    },
    markers:
      !ctx.options.focus ||
      (ctx.options.focus.kind === 'block' && ctx.options.focus.key === type.id),
  };
  return placement.render(root, frame, ctx, {
    class: [...(extra.class ?? []), instance],
    style: extra.style,
    attrs: {
      ...extra.attrs,
      ...(ctx.canvas ? { [BLOCK_ATTRIBUTE]: type.id } : {}),
      ...(placement.path ? fieldMarker(ctx, placement.path) : {}),
    },
  });
}

/** A block list through the block grid, each block placed and designed. */
function renderBlockList(
  node: DesignNode,
  value: unknown,
  path: MarkerPath | null,
  args: Parameters<ElementRenderer>[0],
): VNodeChild {
  const { ctx, attrs } = args;
  const blocks = blocksOf(value);
  const grid: BlockGridSettings =
    gridOf(value) ?? uniformGrid(columnsUsedBy(blocks.map((block) => block.layout ?? null)));
  const variant = typeof node.props?.variant === 'string' ? node.props.variant : null;
  const listAttrs = {
    ...attrs,
    class: [...attrs.class, GRID_CLASS],
    style: [attrs.style, blocksGridStyle(grid)].filter(Boolean).join('; '),
    ...listMarker(ctx, path),
  };
  if (blocks.length === 0) return empty(ctx, listAttrs, 'div', 'Blocks');
  return h(
    'div',
    listAttrs,
    blocks.map((block, index) =>
      renderBlock(block, ctx, {
        render: args.render,
        path: path ? [...path, index] : null,
        variant,
        extra: {
          class: [BLOCK_CLASS],
          style: blockLayoutStyle(block, grid) || undefined,
        },
      }),
    ),
  );
}

const blocks: ElementRenderer = (args) => {
  const resolved = resolveBinding(args.node.bind, args.frame, args.ctx);
  return renderBlockList(args.node, resolved?.value, resolved?.path ?? null, args);
};

/** Template blocks belong to the template document, so they carry no field markers. */
const template: ElementRenderer = (args) => {
  const resolved = resolveBinding(args.node.bind, args.frame, args.ctx);
  return renderBlockList(args.node, resolved?.value, null, args);
};

const block: ElementRenderer = ({ node, frame, ctx, attrs, render }) => {
  const resolved = resolveBinding(node.bind, frame, ctx);
  const value = resolved?.value;
  const single = isRecord(value) && 'blockId' in value ? value : blocksOf(value)[0];
  if (!single) return empty(ctx, attrs, 'div', 'Block');
  return h('div', attrs, [
    renderBlock(single, ctx, {
      render,
      path: resolved?.path ?? null,
      variant: typeof node.props?.variant === 'string' ? node.props.variant : null,
    }),
  ]);
};

/** Entries of a list value: repeater items, relation lists, block lists. */
function entriesOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.blocks)) return value.blocks;
  return value === null || value === undefined ? [] : [value];
}

const repeat: ElementRenderer = ({ node, frame, ctx, attrs, children }) => {
  const field = node.bind?.field;
  if (typeof field !== 'string' || !field) return empty(ctx, attrs, 'div', 'Repeat');
  const resolved = resolveBinding(node.bind, frame, ctx);
  const items = entriesOf(resolved?.value);
  const subDefs = subFieldDefs(resolved?.def ?? null);
  const limit = Number(node.props?.limit);
  const shown = Number.isInteger(limit) && limit > 0 ? items.slice(0, limit) : items;
  const entries: Array<{ item: unknown; index: number }> = shown.map((item, index) => ({
    item,
    index,
  }));
  // The canvas shows the item layout once even without entries.
  if (entries.length === 0 && ctx.canvas) entries.push({ item: null, index: 0 });
  if (entries.length === 0) return null;
  const content = entries.flatMap(({ item, index }) => {
    const repeatFrame: RepeatFrame = {
      item,
      index,
      def: resolved?.def ?? null,
      subDefs,
      path: resolved?.path && item !== null ? [...resolved.path, index] : null,
    };
    const repeats = new Map(frame.data.repeats);
    repeats.set(field, repeatFrame);
    return children({ ...frame, data: { ...frame.data, repeats } });
  });
  return h('div', { ...attrs, ...fieldMarker(ctx, resolved?.path ?? null) }, content);
};

export const dataElements: Record<DataElement, ElementRenderer> = {
  repeat,
  blocks,
  block,
  template,
};
