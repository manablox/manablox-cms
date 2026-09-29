<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import {
  BOARD_BREAKPOINT,
  placeBlocks,
  placementAt,
  withPlacement,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import { useBlockAdder } from '@manablox/admin-sdk/features/content/useBlockAdder';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { focusFirstFieldSoon } from '@manablox/admin-sdk/lib/focus';
import type { BlockBreakpoint, BlockPlacement, BlocksValue, BlockValue } from '@manablox/core';
import { computed, inject, nextTick, ref, useTemplateRef } from 'vue';
import DropLine from '~/components/DropLine.vue';
import { useListReorder } from '~/composables/useListReorder';
import BlockAddMenu from '~/features/content/components/BlockAddMenu.vue';
import BlockEditDialog from '~/features/content/components/BlockEditDialog.vue';
import BlockGridBoard from '~/features/content/components/BlockGridBoard.vue';
import BlockGridSettings from '~/features/content/components/BlockGridSettings.vue';
import BlockRow from '~/features/content/components/BlockRow.vue';
import BlockTypeDialog from '~/features/content/components/BlockTypeDialog.vue';
import { blockSummary } from '~/features/content/model/block-types';
import { useBlocksValue } from '~/features/content/useBlocksValue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [BlocksValue] }>();

const context = useFieldContext();
const readOnly = computed(() => context.value.readOnly);
const open = ref<Set<string>>(new Set());
const showMenu = ref(false);

const {
  blocks,
  gridValue,
  grid,
  isGrid,
  setGrid,
  updateLayout,
  append,
  removeBlock,
  updateBlock,
  replaceBlock,
  move,
} = useBlocksValue(
  () => props.modelValue,
  (next) => emit('update:modelValue', next),
);

/** No `types` means every block type of the space (block types are per space). */
const allowed = computed(() => {
  const ids = (props.settings.types as string[]) ?? [];
  if (!ids.length) return context.value.blockTypes();
  return ids
    .map((id) => context.value.typeById(id))
    .filter((type): type is NonNullable<typeof type> => type !== null);
});

// In the visual editor the board follows the previewed device.
const sharedBreakpoint = inject(BOARD_BREAKPOINT, null);
const breakpoint = sharedBreakpoint ?? ref<BlockBreakpoint>('desktop');
const selectedId = ref<string | null>(null);

/** Opens the block in the list, or in a dialog when only the board is shown. */
function selectFromBoard(blockId: string) {
  selectedId.value = blockId;
  if (boardOnly.value) {
    editing.value = blockId;
    return;
  }
  if (!open.value.has(blockId)) toggle(blockId);
}

/** Under a grid the list is hidden by default. */
const showList = ref(false);
const boardOnly = computed(() => isGrid.value && !showList.value);

/** `editing`: block open in the dialog. `pending`: drawn placement. `picking`: type dialog open. */
const editing = ref<string | null>(null);
const pending = ref<BlockPlacement | null>(null);
const picking = ref(false);
const editingBlock = computed(
  () => blocks.value.find((block) => block.blockId === editing.value) ?? null,
);
const editingIndex = computed(() =>
  blocks.value.findIndex((block) => block.blockId === editing.value),
);
const editingLabel = computed(
  () => context.value.typeById(editingBlock.value?.type ?? '')?.label ?? 'Block',
);

/** Placement sentence for the dialog header. */
const editingPlacement = computed(() => {
  if (!editingBlock.value || !isGrid.value) return null;
  const cell = placeBlocks(blocks.value, breakpoint.value, grid.value).get(
    editingBlock.value.blockId,
  );
  if (!cell) return null;
  const size = `${cell.columnSpan} x ${cell.rowSpan}`;
  return cell.auto
    ? `Placed by the grid, ${size}`
    : `Column ${cell.column}, row ${cell.row}, ${size}`;
});

/** A rectangle was drawn; a single allowed type is inserted directly, otherwise ask. */
function insertAt(placement: BlockPlacement) {
  if (!allowed.value.length) return;
  pending.value = placement;
  const only = allowed.value.length === 1 ? allowed.value[0] : null;
  if (only) insertType(only.id);
  else picking.value = true;
}

function insertType(typeId: string) {
  const placement = pending.value;
  pending.value = null;
  picking.value = false;
  const blockId = crypto.randomUUID();
  const layout = placement ? withPlacement(undefined, breakpoint.value, placement) : undefined;
  append({ blockId, type: typeId, fields: {}, ...(layout ? { layout } : {}) });
  selectedId.value = blockId;
  editing.value = blockId;
}

function removeEditing() {
  if (editing.value) remove(editing.value);
  editing.value = null;
}

function layoutLabel(block: BlockValue): string | null {
  if (!isGrid.value) return null;
  const placement = placementAt(block.layout, breakpoint.value, grid.value);
  if (!placement || placement.column === undefined) return 'auto';
  const { column = 1, row = 1, columnSpan = 1, rowSpan = 1 } = placement;
  return `c${column} r${row} - ${columnSpan}x${rowSpan}`;
}

function add(typeId: string) {
  const blockId = crypto.randomUUID();
  append({ blockId, type: typeId, fields: {} });
  showMenu.value = false;
  // Open it and focus its first field.
  open.value = new Set(open.value).add(blockId);
  void nextTick(() => {
    const panel = root.value?.querySelector<HTMLElement>(`[data-block-panel="${blockId}"]`);
    if (panel) focusFirstFieldSoon(panel);
    panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

const root = useTemplateRef<HTMLElement>('root');
const addBar = useTemplateRef<HTMLElement>('addBar');

/** Alt+N: insert a single allowed type, otherwise open the add menu (or the type dialog under a grid). */
useBlockAdder({
  root: () => root.value,
  can: () => !readOnly.value && allowed.value.length > 0,
  add: () => {
    const only = allowed.value.length === 1 ? allowed.value[0] : null;
    if (boardOnly.value) {
      pending.value = null;
      if (only) insertType(only.id);
      else picking.value = true;
      return;
    }
    if (only) {
      add(only.id);
      return;
    }
    // The menu anchors to its button.
    addBar.value?.scrollIntoView({ block: 'nearest' });
    showMenu.value = true;
  },
});

function remove(blockId: string) {
  removeBlock(blockId);
  if (selectedId.value === blockId) selectedId.value = null;
}

function replaceEditing(next: BlockValue) {
  if (editingBlock.value) replaceBlock(editingBlock.value.blockId, next);
}

const { draggingKey, dropAt, onDragStart, onDragEnd, onDragOver, onDrop } = useListReorder(
  () => blocks.value,
  (block) => block.blockId,
  move,
);

/** A block whose own fields failed to save; its index is what the server's path carries. */
function invalid(index: number): boolean {
  return context.value.errorUnder([...props.path, index]);
}
function invalidBlock(block: BlockValue): boolean {
  return invalid(blocks.value.indexOf(block));
}
/** Invalid blocks open themselves, so the bad field is on screen. */
function isOpen(blockId: string, index: number): boolean {
  return open.value.has(blockId) || invalid(index);
}

function toggle(blockId: string) {
  const next = new Set(open.value);
  if (next.has(blockId)) next.delete(blockId);
  else next.add(blockId);
  open.value = next;
  selectedId.value = next.has(blockId) ? blockId : selectedId.value;
}

/** Collapsed label: the first summary field's value. */
const summary = (block: BlockValue) => blockSummary(block, context.value);

/** Board card label: type plus summary. */
function boardLabel(block: BlockValue): string {
  const type = context.value.typeById(block.type)?.label ?? 'Block';
  return `${type} - ${summary(block)}`;
}
</script>

<template>
  <div ref="root" class="space-y-3">
    <BlockGridSettings :value="gridValue" :grid="grid" :is-grid="isGrid" :read-only="readOnly" @set="setGrid" />

    <!-- Grid board: draw to add, drag to move, corner to resize, click to open. -->
    <div v-if="isGrid" class="space-y-2 rounded-card border border-surface-200 p-3 dark:border-surface-700">
      <BlockGridBoard
        v-model:breakpoint="breakpoint"
        :hide-breakpoints="sharedBreakpoint !== null"
        :blocks="blocks"
        :grid="grid"
        :selected-id="selectedId"
        :label-of="boardLabel"
        :invalid-of="invalidBlock"
        :insertable="!readOnly"
        :read-only="readOnly"
        @update:layout="updateLayout"
        @active="selectedId = $event"
        @select="selectFromBoard"
        @insert="insertAt"
      />
      <div class="flex items-center gap-2 mb-meta">
        <span class="flex-1">
          <template v-if="readOnly">Click a block to open it.</template>
          <template v-else>{{ blocks.length ? 'Click or drag across empty cells to add a block there.' : 'Drag across the empty cells to place your first block.' }}</template>
        </span>
        <button type="button" class="mb-btn-ghost mb-btn-sm" :aria-pressed="showList" @click="showList = !showList">
          <Icon name="list" class="mb-icon-sm" />
          {{ showList ? 'Hide the list' : 'Show as a list' }}
        </button>
      </div>
    </div>

    <ul v-if="!boardOnly">
      <li v-for="(block, index) in blocks" :key="block.blockId">
        <!-- The gap between blocks is the drop target. -->
        <DropLine :active="dropAt === index" @dragover="onDragOver($event, index)" @drop="onDrop($event, index)" />

        <BlockRow
          :block="block"
          :index="index"
          :count="blocks.length"
          :path="path"
          :read-only="readOnly"
          :open="isOpen(block.blockId, index)"
          :invalid="invalid(index)"
          :selected="selectedId === block.blockId && isGrid"
          :dragging="draggingKey === block.blockId"
          :summary="summary(block)"
          :layout-label="layoutLabel(block)"
          @toggle="toggle(block.blockId)"
          @move="move(index, $event)"
          @remove="remove(block.blockId)"
          @update:fields="updateBlock(block.blockId, $event)"
          @replace="replaceBlock(block.blockId, $event)"
          @dragstart="onDragStart($event, block.blockId)"
          @dragend="onDragEnd"
        />
      </li>

      <!-- Trailing drop target. -->
      <li v-if="blocks.length">
        <DropLine :active="dropAt === blocks.length" @dragover="onDragOver($event, blocks.length)" @drop="onDrop($event, blocks.length)" />
      </li>
    </ul>

    <div v-if="!boardOnly && !readOnly" ref="addBar">
      <BlockAddMenu v-model:open="showMenu" :allowed="allowed" @add="add" />
    </div>

    <!-- Type choice for a new block. -->
    <BlockTypeDialog
      v-if="picking && allowed.length > 1"
      :allowed="allowed"
      @pick="insertType"
      @close="pending = null; picking = false"
    />

    <!-- Block opened from the board. -->
    <BlockEditDialog
      v-if="editingBlock"
      :block="editingBlock"
      :label="editingLabel"
      :placement="editingPlacement"
      :path="[...path, editingIndex]"
      :read-only="readOnly"
      @update:fields="updateBlock(editingBlock.blockId, $event)"
      @replace="replaceEditing"
      @remove="removeEditing"
      @close="editing = null"
    />
  </div>
</template>
