import { listAttribute } from '@manablox/live-preview';
import {
  BLOCK_CLASS,
  type Block,
  blockLayoutStyle,
  blocksGridStyle,
  columnsUsedBy,
  GRID_CLASS,
  gridOf,
  uniformGrid,
} from '@manablox/public-sdk';
import { blockRenderers } from './blocks/index.js';

/**
 * A blocks field, each block through the registry in `./blocks/index.ts`. The list is
 * tagged for the visual editor, so it can offer "add a block" while it is empty, and
 * laid out as a grid when the admin placed the blocks on one: each block's layout
 * becomes the custom properties the SDK's stylesheet reads.
 *
 * `path` is where the field sits: `['components']` on a page, deeper inside a block.
 */
export function Blocks({
  blocks,
  path,
  value,
}: {
  blocks: Block[];
  path: (string | number)[];
  value?: unknown;
}) {
  const grid = gridOf(value) ?? uniformGrid(columnsUsedBy(blocks));

  return (
    <div className={GRID_CLASS} {...listAttribute(path)} style={cssText(blocksGridStyle(grid))}>
      {blocks.map((block, index) => {
        const Renderer = blockRenderers[block.type];
        const style = cssText(blockLayoutStyle(block, grid));
        return Renderer ? (
          <div key={block.blockId} className={BLOCK_CLASS} style={style}>
            <Renderer block={block} path={[...path, index]} />
          </div>
        ) : (
          // An unknown block type renders a visible note rather than vanishing.
          <div key={block.blockId} className={`${BLOCK_CLASS} unknown`} style={style}>
            No renderer for block type "{block.type}".
          </div>
        );
      })}
    </div>
  );
}

/**
 * The SDK hands out a CSS declaration list, and React's `style` takes an object. The
 * declarations are custom properties, which React passes through untouched.
 */
function cssText(text: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const declaration of text.split(';')) {
    const [property, ...rest] = declaration.split(':');
    if (!property || rest.length === 0) continue;
    style[property.trim()] = rest.join(':').trim();
  }
  return style;
}
