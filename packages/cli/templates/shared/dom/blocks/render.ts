import { listAttribute } from '@manablox/live-preview';
import {
  BLOCK_CLASS,
  type Block,
  blockLayoutStyle,
  blocksGridStyle,
  blocksOf,
  columnsUsedBy,
  GRID_CLASS,
  gridOf,
  uniformGrid,
} from '@manablox/public-sdk';
import { el } from '../dom.js';
import { blockRenderers } from './index.js';

/** One block, through the registry. An unknown type renders a visible note rather than vanishing. */
export function renderBlock(block: Block, path: (string | number)[]): HTMLElement {
  const renderer = blockRenderers[block.type];
  if (renderer) return renderer(block, path);
  return el('div', { class: 'unknown' }, `No renderer for block type "${block.type}".`);
}

/**
 * A blocks field. It arrives as `{ grid, blocks }`. The list is tagged so the visual editor
 * can offer "add a block" while it is empty, and laid out as a grid when the admin placed the
 * blocks on one: the SDK's stylesheet (`BLOCK_GRID_CSS`) reads the custom properties set here.
 */
export function renderBlocks(value: unknown, path: (string | number)[]): HTMLElement {
  const blocks = blocksOf(value);
  const grid = gridOf(value) ?? uniformGrid(columnsUsedBy(blocks));

  return el(
    'div',
    { class: GRID_CLASS, ...listAttribute(path), style: blocksGridStyle(grid) },
    ...blocks.map((block, index) => {
      const element = renderBlock(block, [...path, index]);
      element.classList.add(BLOCK_CLASS);
      const style = blockLayoutStyle(block, grid);
      if (style) element.style.cssText += `;${style}`;
      return element;
    }),
  );
}
