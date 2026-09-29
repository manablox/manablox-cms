import type { Block } from '@manablox/public-sdk';
import { renderTeaser } from './teaser.js';

/**
 * The block renderer registry: a block whose type is `teaser` renders a teaser. The
 * convention is not framework specific; a map from type name to a function returning an
 * element is all a `<component :is>` lookup does elsewhere.
 */
export type BlockRenderer = (block: Block, path: (string | number)[]) => HTMLElement;

export const blockRenderers: Record<string, BlockRenderer> = {
  teaser: renderTeaser,
};
