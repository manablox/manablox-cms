<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import {
  type BoardCell,
  hasOwnPlacement,
  withPlacement,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import type { BlockBreakpoint, BlockGridSettings, BlockLayout, BlockValue } from '@manablox/core';
import { computed } from 'vue';
import {
  type BoardBounds,
  clampPlacement,
  matchesDesktop,
  stepperRange,
} from '../model/block-board';

/** The selected board block's column, row, width and height steppers, and its release to auto. */
const props = defineProps<{
  block: BlockValue;
  /** Where the block sits on this breakpoint's grid. */
  cell: BoardCell;
  grid: BlockGridSettings;
  breakpoint: BlockBreakpoint;
  bounds: BoardBounds;
}>();

const emit = defineEmits<{
  'update:layout': [blockId: string, layout: BlockLayout | undefined];
}>();

const own = computed(() => hasOwnPlacement(props.block.layout, props.breakpoint));
/** Off desktop, a block without its own placement follows desktop only on an equal grid. */
const followsDesktop = computed(() => matchesDesktop(props.grid, props.breakpoint));

const steppers = computed(() =>
  (
    [
      { key: 'column', label: 'Column' },
      { key: 'row', label: 'Row' },
      { key: 'columnSpan', label: 'Width' },
      { key: 'rowSpan', label: 'Height' },
    ] as const
  ).map((control) => ({ ...control, ...stepperRange(control.key, props.cell, props.bounds) })),
);

function step(key: keyof BoardCell, delta: number) {
  const next = { ...props.cell, [key]: props.cell[key] + delta };
  emit(
    'update:layout',
    props.block.blockId,
    withPlacement(props.block.layout, props.breakpoint, clampPlacement(next, props.bounds)),
  );
}

/** Clears this breakpoint's placement (auto, or following desktop). */
function release() {
  emit(
    'update:layout',
    props.block.blockId,
    withPlacement(props.block.layout, props.breakpoint, null),
  );
}
</script>

<template>
  <div class="space-y-2">
    <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      <div v-for="control in steppers" :key="control.key" class="flex items-center justify-between gap-2">
        <span class="text-surface-600 dark:text-surface-300">{{ control.label }}</span>
        <span class="flex items-center gap-0.5">
          <button type="button" class="mb-btn-ghost mb-btn-icon mb-btn-sm" :aria-label="`${control.label} less`" :disabled="cell[control.key] <= control.min" @click="step(control.key, -1)">-</button>
          <span class="w-6 text-center tabular-nums">{{ cell[control.key] }}</span>
          <button type="button" class="mb-btn-ghost mb-btn-icon mb-btn-sm" :aria-label="`${control.label} more`" :disabled="cell[control.key] >= control.max" @click="step(control.key, 1)">+</button>
        </span>
      </div>
    </div>
    <div class="flex items-center gap-2 text-xs">
      <button v-if="own" type="button" class="mb-btn-ghost mb-btn-sm" @click="release">
        <Icon name="reset" class="mb-icon-sm" />
        {{ followsDesktop ? 'Same as desktop' : 'Let the grid place it' }}
      </button>
      <span v-else class="text-surface-500">
        {{ followsDesktop ? 'Follows the desktop placement; drag it to set its own.' : 'Placed by the grid; drag it to pin it.' }}
      </span>
    </div>
  </div>
</template>
