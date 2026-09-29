<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import {
  type BoardCell,
  BREAKPOINTS,
  placeBlocks,
  withPlacement,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import type {
  BlockBreakpoint,
  BlockGridSettings,
  BlockLayout,
  BlockPlacement,
  BlockValue,
} from '@manablox/core';
import { computed, ref } from 'vue';
import BlockPlacementControls from '~/features/content/components/BlockPlacementControls.vue';
import {
  BOARD_HANDLES,
  type BoardPoint,
  boardCells,
  cellKey,
  clampPlacement,
  gridArea,
  occupiedCells,
  visibleRows,
} from '~/features/content/model/block-board';
import { useBoardPointer } from '~/features/content/useBoardPointer';

/** Miniature grid of a `blocks` field for one breakpoint; placement math is in `features/content/model/block-board.ts`. */
const props = defineProps<{
  blocks: BlockValue[];
  grid: BlockGridSettings;
  breakpoint: BlockBreakpoint;
  selectedId?: string | null | undefined;
  labelOf: (block: BlockValue) => string;
  /** Marks a block whose fields failed to save. */
  invalidOf?: ((block: BlockValue) => boolean) | undefined;
  hideBreakpoints?: boolean;
  /** Allows drawing on empty cells to add a block. */
  insertable?: boolean;
  /** Blocks open on click but do not move or resize. */
  readOnly?: boolean;
}>();
const emit = defineEmits<{
  'update:breakpoint': [BlockBreakpoint];
  'update:layout': [blockId: string, layout: BlockLayout | undefined];
  /** Pointer down on a block. */
  active: [blockId: string];
  /** Clicked without dragging. */
  select: [blockId: string];
  insert: [placement: BlockPlacement];
}>();

const columns = computed(() => Math.max(1, props.grid[props.breakpoint].columns));
const fixedRows = computed(() => props.grid[props.breakpoint].rows);
const bounds = computed(() => ({ columns: columns.value, fixedRows: fixedRows.value }));

const placed = computed(() => placeBlocks(props.blocks, props.breakpoint, props.grid));
const rows = computed(() =>
  visibleRows(placed.value.values(), {
    fixedRows: fixedRows.value,
    insertable: props.insertable,
  }),
);
const cells = computed(() => boardCells(columns.value, rows.value));
const occupied = computed(() => occupiedCells(placed.value.values()));

const selected = computed(() =>
  props.selectedId
    ? (props.blocks.find((block) => block.blockId === props.selectedId) ?? null)
    : null,
);
const selectedCell = computed(() =>
  selected.value ? (placed.value.get(selected.value.blockId) ?? null) : null,
);

function commit(block: BlockValue, next: BoardCell) {
  emit(
    'update:layout',
    block.blockId,
    withPlacement(block.layout, props.breakpoint, clampPlacement(next, bounds.value)),
  );
}

const map = ref<HTMLElement | null>(null);
const { dragging, startDrag, onDrag, endDrag, drawn, startDraw, onDraw, endDraw } = useBoardPointer(
  {
    map,
    blocks: () => props.blocks,
    placed: () => placed.value,
    occupied: () => occupied.value,
    readOnly: () => Boolean(props.readOnly),
    insertable: () => Boolean(props.insertable),
    commit,
    onActive: (blockId) => emit('active', blockId),
    onSelect: (blockId) => emit('select', blockId),
    onInsert: (placement) => emit('insert', placement),
  },
);

/** Keyboard insert: a one-cell block at the focused cell. */
function insertAt(cell: BoardPoint) {
  if (!props.insertable || occupied.value.has(cellKey(cell.column, cell.row))) return;
  emit('insert', { ...cell, columnSpan: 1, rowSpan: 1 });
}

const breakpointOptions = BREAKPOINTS.map((entry) => ({
  value: entry.value,
  label: entry.label,
  icon: entry.icon,
  hint: `${props.grid[entry.value].columns} ${props.grid[entry.value].columns === 1 ? 'column' : 'columns'}`,
}));
</script>

<template>
  <div class="space-y-3">
    <div v-if="!hideBreakpoints" class="flex items-center justify-between gap-3">
      <SegmentedControl
        :model-value="breakpoint"
        :options="breakpointOptions"
        aria-label="Breakpoint"
        icon-only
        @update:model-value="emit('update:breakpoint', $event)"
      />
      <span class="mb-meta">
        {{ columns }} {{ columns === 1 ? 'column' : 'columns' }}{{ fixedRows ? `, ${fixedRows} rows` : '' }}
      </span>
    </div>

    <div
      ref="map"
      class="relative grid gap-1 rounded-control border border-surface-200 bg-surface-100 p-1.5 dark:border-surface-700 dark:bg-surface-800"
      :class="dragging ? 'select-none' : ''"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      role="group"
      aria-label="Blocks on the grid"
    >
      <component
        :is="insertable && !occupied.has(cellKey(cell.column, cell.row)) ? 'button' : 'div'"
        v-for="cell in cells"
        :key="`${cell.column}-${cell.row}`"
        data-cell
        :data-column="cell.column"
        :data-row="cell.row"
        :type="insertable ? 'button' : undefined"
        class="h-9 rounded border border-dashed border-surface-300 bg-surface-0/60 dark:border-surface-600 dark:bg-surface-900/60"
        :class="
          insertable && !occupied.has(cellKey(cell.column, cell.row))
            ? 'cursor-copy transition-colors hover:border-brand-400 hover:bg-brand-50 dark:hover:border-brand-500 dark:hover:bg-brand-950/40'
            : ''
        "
        :style="{ gridColumn: cell.column, gridRow: cell.row }"
        :aria-hidden="insertable ? undefined : 'true'"
        :aria-label="insertable ? `Add a block at column ${cell.column}, row ${cell.row}` : undefined"
        @pointerdown="startDraw($event, cell)"
        @pointermove="onDraw"
        @pointerup="endDraw"
        @pointercancel="endDraw"
        @keydown.enter.prevent="insertAt(cell)"
        @keydown.space.prevent="insertAt(cell)"
      />

      <!-- Rectangle being drawn. -->
      <div
        v-if="drawn"
        class="pointer-events-none flex items-center justify-center rounded border-2 border-brand-500 bg-brand-500/15 text-2xs font-semibold text-brand-700 dark:text-brand-200"
        :style="gridArea(drawn)"
        aria-hidden="true"
      >
        <Icon name="plus" class="mb-icon-sm" />
      </div>

      <button
        v-for="block in blocks"
        :key="block.blockId"
        type="button"
        class="group relative flex min-w-0 items-center justify-center overflow-hidden rounded px-1.5 text-2xs font-semibold shadow-sm transition-shadow"
        :class="[
          readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
          invalidOf?.(block)
            ? 'mb-invalid bg-danger-50 text-danger-700 ring-2 ring-danger-400 dark:bg-danger-500/15 dark:text-danger-200 dark:ring-danger-500'
            : block.blockId === selectedId
              ? 'bg-brand-500 text-white ring-2 ring-brand-300 dark:ring-brand-600'
              : 'bg-surface-0 text-surface-700 ring-1 ring-surface-300 hover:ring-brand-400 dark:bg-surface-900 dark:text-surface-200 dark:ring-surface-600',
          placed.get(block.blockId)?.auto ? 'mb-board-auto' : '',
          // While anything is being dragged, no card is in the way: the cell under the
          // pointer is what the drag follows, and a card over it would hide the ground
          // being dragged towards - including the neighbour a block is resized across.
          // The dragged card keeps receiving events through its pointer capture.
          dragging ? 'pointer-events-none' : '',
        ]"
        :style="gridArea(placed.get(block.blockId) ?? { column: 1, row: 1, columnSpan: 1, rowSpan: 1 })"
        :title="readOnly ? labelOf(block) : `${labelOf(block)}: drag to move, click to open`"
        :aria-label="`${labelOf(block)}, column ${placed.get(block.blockId)?.column}, row ${placed.get(block.blockId)?.row}`"
        :aria-pressed="block.blockId === selectedId"
        :data-invalid="invalidOf?.(block) ? '' : undefined"
        @pointerdown="startDrag($event, block, null)"
        @pointermove="onDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
      >
        <span class="pointer-events-none truncate">{{ labelOf(block) }}</span>

        <!-- Resize handles. -->
        <span
          v-for="handle in readOnly ? [] : BOARD_HANDLES"
          :key="handle.id"
          class="mb-z-local absolute"
          :class="handle.class"
          :title="`Drag the ${handle.label} to resize`"
          @pointerdown.stop="startDrag($event, block, { x: handle.x, y: handle.y })"
          @pointermove.stop="onDrag"
          @pointerup.stop="endDrag"
          @pointercancel.stop="endDrag"
        />

        <!-- Corner grip hint. -->
        <span
          class="pointer-events-none absolute right-0.5 bottom-0.5 h-2 w-2 rounded-sm border-r-2 border-b-2 border-current opacity-0 transition-opacity group-hover:opacity-40"
          aria-hidden="true"
        />
      </button>
    </div>

    <BlockPlacementControls
      v-if="selected && selectedCell && !readOnly"
      :block="selected"
      :cell="selectedCell"
      :grid="grid"
      :breakpoint="breakpoint"
      :bounds="bounds"
      @update:layout="(blockId, layout) => emit('update:layout', blockId, layout)"
    />
  </div>
</template>

<style scoped>
.mb-board-auto {
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0 6px,
    color-mix(in oklab, currentColor 12%, transparent) 6px 8px
  );
}
</style>
