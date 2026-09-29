<script setup lang="ts">
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
import { computed } from 'vue';
import { blockRenderers as renderers } from './blocks/index.js';

/**
 * A blocks field, each block through the registry in `./blocks/index.ts`. The list is
 * tagged for the visual editor, so it can offer "add a block" while it is empty, and laid
 * out as a grid when the admin placed the blocks on one.
 *
 * `path` is where the field sits: `['components']` on a page, deeper inside a block.
 */
const props = defineProps<{ blocks: Block[]; path: (string | number)[]; value?: unknown }>();

const grid = computed(() => gridOf(props.value) ?? uniformGrid(columnsUsedBy(props.blocks)));
</script>

<template>
  <div :class="GRID_CLASS" v-bind="listAttribute(path)" :style="blocksGridStyle(grid)">
    <template v-for="(block, index) in blocks" :key="block.blockId">
      <component
        :is="renderers[block.type]"
        v-if="renderers[block.type]"
        :class="BLOCK_CLASS"
        :style="blockLayoutStyle(block, grid) || undefined"
        :block="block"
        :path="[...path, index]"
      />
      <!-- An unknown block type renders a visible note rather than vanishing. -->
      <div
        v-else
        :class="[BLOCK_CLASS, 'unknown']"
        :style="blockLayoutStyle(block, grid) || undefined"
      >
        No renderer for block type "{{ block.type }}".
      </div>
    </template>
  </div>
</template>
