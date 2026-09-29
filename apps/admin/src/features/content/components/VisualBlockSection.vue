<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { BlockBreakpoint, BlockGridSettings, BlockLayout, BlockValue } from '@manablox/core';
import type { FieldPath } from '@manablox/live-preview';
import PluginSlot from '~/components/PluginSlot';
import BlockEditor from './BlockEditor.vue';
import BlockGridBoard from './BlockGridBoard.vue';

/**
 * The visual editor's selected block: a bar to go back, move, add after or delete it, its
 * layout on the list's grid, its fields and the plugins' inspectors.
 */
defineProps<{
  block: BlockValue;
  path: FieldPath;
  /** The label of the list around the block. */
  listLabel: string;
  index: number;
  siblings: BlockValue[];
  /** The list's grid, when it has one. */
  grid: BlockGridSettings | null;
  typeLabel: string;
  deviceLabel: string;
  readOnly: boolean;
  labelOf: (block: BlockValue) => string;
}>();

const device = defineModel<BlockBreakpoint>('device', { required: true });

const emit = defineEmits<{
  back: [];
  move: [to: number];
  addAfter: [];
  remove: [];
  layout: [blockId: string, layout: BlockLayout | undefined];
  /** A sibling picked on the board. */
  select: [blockId: string];
  'update:fields': [fields: Record<string, unknown>];
  replace: [block: BlockValue];
}>();

const spaces = useSpaceStore();
</script>

<template>
  <div class="mb-z-sticky sticky top-0 flex items-center gap-1 border-b border-surface-200 bg-surface-0/95 px-3 py-2 backdrop-blur dark:border-surface-800 dark:bg-surface-900/95">
    <IconButton icon="chevron" icon-class="mb-icon rotate-180" label="Back to all blocks" title="All blocks" @click="emit('back')" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-2xs text-surface-500">
        {{ listLabel }}
      </div>
      <div class="flex items-center gap-1.5 text-sm font-semibold">
        <Icon :name="typeIcon(spaces.typeById(block.type), 'blocks')" class="mb-icon-sm shrink-0 text-surface-500" />
        <span class="truncate">{{ typeLabel }}</span>
        <span class="shrink-0 font-normal text-surface-500">- {{ index + 1 }} of {{ siblings.length }}</span>
      </div>
    </div>
    <template v-if="!readOnly">
      <IconButton icon="up" label="Move up" :disabled="index <= 0" @click="emit('move', index - 1)" />
      <IconButton icon="down" label="Move down" :disabled="index >= siblings.length - 1" @click="emit('move', index + 1)" />
      <IconButton icon="plus" label="Add a block after this one" title="Add after" @click="emit('addAfter')" />
      <IconButton icon="trash" label="Delete block" title="Delete" danger @click="emit('remove')" />
    </template>
  </div>

  <section v-if="grid" class="space-y-3 border-b border-surface-200 p-4 dark:border-surface-800">
    <div class="flex items-center justify-between">
      <h3 class="mb-eyebrow">Layout</h3>
      <span class="text-2xs text-surface-500">{{ deviceLabel }} grid</span>
    </div>
    <BlockGridBoard
      :blocks="siblings"
      :grid="grid"
      :breakpoint="device"
      :selected-id="block.blockId"
      :label-of="labelOf"
      :read-only="readOnly"
      hide-breakpoints
      @update:breakpoint="device = $event"
      @update:layout="(id, layout) => emit('layout', id, layout)"
      @select="emit('select', $event)"
    />
  </section>

  <section class="space-y-3 p-4" data-block-fields>
    <h3 class="mb-eyebrow">Fields</h3>
    <BlockEditor :block="block" :path="path" @update:fields="emit('update:fields', $event)" />
  </section>

  <!-- Hidden while no entry renders anything. -->
  <section class="border-t border-surface-200 p-4 empty:hidden dark:border-surface-800">
    <PluginSlot
      id="block.inspector"
      :props="{ block, type: spaces.typeById(block.type), path, readOnly, update: (next) => emit('replace', next), panel: true }"
    />
  </section>
</template>
