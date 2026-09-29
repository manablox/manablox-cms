import type { Component } from 'vue';
import Teaser from './Teaser.vue';

/**
 * The block renderer registry: a block whose type is `teaser` renders `<Teaser>`. Every
 * block component takes the block and the path it sits at in the document.
 */
export const blockRenderers: Record<string, Component> = {
  teaser: Teaser,
};
