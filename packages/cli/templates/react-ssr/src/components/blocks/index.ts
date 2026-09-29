import type { Block } from '@manablox/public-sdk';
import type { ComponentType } from 'react';
import { Teaser } from './Teaser.js';

/** What every block component is given: the block, and where it sits in the document. */
export interface BlockProps {
  block: Block;
  path: (string | number)[];
}

/** The block renderer registry: a block whose type is `teaser` renders `<Teaser>`. */
export const blockRenderers: Record<string, ComponentType<BlockProps>> = {
  teaser: Teaser,
};
