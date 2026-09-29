<script setup lang="ts">
import { fieldAttribute, listAttribute } from '@manablox/live-preview';
import {
  BLOCK_CLASS,
  BLOCK_GRID_CSS,
  type Block,
  type BlockGridSettings,
  blockLayoutStyle,
  blocksGridStyle,
  blocksOf,
  columnsUsedBy,
  GRID_CLASS,
  gridOf,
  pascalName,
  uniformGrid,
} from '@manablox/public-sdk';
import { type Component, computed, resolveComponent } from 'vue';

/**
 * Renders blocks by type convention (`teaser` renders `<BlockTeaser>`), tagged for the visual
 * editor. Takes a `blocks` field value, `{ grid, blocks }`.
 */
const props = withDefaults(
  defineProps<{
    blocks: { grid?: BlockGridSettings | null; blocks: Block[] } | null | undefined;
    field?: string;
    prefix?: string;
    /** Overrides the grid the value carries. */
    grid?: BlockGridSettings | null;
    /** Any CSS length. */
    gap?: string | undefined;
  }>(),
  { field: 'components', prefix: 'Block', grid: null, gap: undefined },
);

const items = computed(() => blocksOf(props.blocks));

const resolved = computed(
  () =>
    props.grid ??
    gridOf(props.blocks) ??
    uniformGrid(columnsUsedBy(items.value.map((block) => block.layout ?? null))),
);
const gridStyle = computed(() =>
  blocksGridStyle(resolved.value, props.gap ? { gap: props.gap } : {}),
);

/** GraphQL names the type in `typeName`, REST in `type`. */
function componentFor(block: Block): Component | string {
  const name = typeof block.typeName === 'string' ? block.typeName : block.type;
  return resolveComponent(pascalName(name ?? '', props.prefix));
}

const stylesheet = BLOCK_GRID_CSS;
</script>

<template>
  <div :class="GRID_CLASS" v-bind="listAttribute([field])" :style="gridStyle">
    <component :is="'style'">{{ stylesheet }}</component>
    <component
      :is="componentFor(block)"
      v-for="(block, index) in items"
      :key="block.blockId"
      :class="BLOCK_CLASS"
      v-bind="{ ...block, ...fieldAttribute([field, index]) }"
      :style="blockLayoutStyle(block.layout ?? null, resolved) || undefined"
    />
  </div>
</template>
