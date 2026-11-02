<script setup lang="ts">
import { Icon, IconButton } from '@manablox/admin-sdk';
import { nextTick, ref } from 'vue';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../model/elements';
import type { DropPosition, OutlineRow } from '../model/outline';

/**
 * The element tree of a design as an outline: select, rename, drag to reorder or nest, and
 * keyboard edits. It only emits; the designer checks and applies every change.
 */
const props = defineProps<{
  rows: OutlineRow[];
  selectedId: string | null;
  hoveredId: string | null;
  collapsed: ReadonlySet<string>;
  readOnly: boolean;
  /** Whether a dragged node may land at a spot, for the drop feedback. */
  canPlace: (id: string, targetId: string, position: DropPosition) => boolean;
}>();
const emit = defineEmits<{
  select: [id: string | null];
  hover: [id: string | null];
  toggle: [id: string];
  place: [id: string, targetId: string, position: DropPosition];
  remove: [id: string];
  duplicate: [id: string];
  rename: [id: string, label: string];
  shift: [id: string, delta: -1 | 1];
  indent: [id: string];
  outdent: [id: string];
}>();

const dragging = ref<string | null>(null);
const drop = ref<{ id: string; position: DropPosition } | null>(null);

function onDragStart(event: DragEvent, id: string) {
  if (props.readOnly) return;
  dragging.value = id;
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragEnd() {
  dragging.value = null;
  drop.value = null;
}

/** Top quarter: before; bottom quarter: after; middle: inside a container. */
function positionAt(event: DragEvent, row: OutlineRow): DropPosition {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
  if (row.depth === 0) return 'inside';
  if (row.container) return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
  return y < 0.5 ? 'before' : 'after';
}

function onDragOver(event: DragEvent, row: OutlineRow) {
  const id = dragging.value;
  if (!id) return;
  const position = positionAt(event, row);
  if (!props.canPlace(id, row.id, position)) {
    drop.value = null;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  drop.value = { id: row.id, position };
}

function onDrop(event: DragEvent, row: OutlineRow) {
  const id = dragging.value;
  const target = drop.value;
  onDragEnd();
  if (!id || !target || target.id !== row.id) return;
  event.preventDefault();
  emit('place', id, row.id, target.position);
}

// Renaming.
const renaming = ref<string | null>(null);
const renameText = ref('');
const renameInput = ref<HTMLInputElement[] | null>(null);

async function startRename(row: OutlineRow) {
  if (props.readOnly) return;
  renaming.value = row.id;
  renameText.value = row.label;
  await nextTick();
  renameInput.value?.[0]?.select();
}

function finishRename(commit: boolean) {
  const id = renaming.value;
  renaming.value = null;
  if (commit && id) emit('rename', id, renameText.value);
  tree.value?.focus();
}

// Keyboard.
const tree = ref<HTMLElement | null>(null);

function onKeydown(event: KeyboardEvent) {
  if (renaming.value) return;
  const index = props.rows.findIndex((row) => row.id === props.selectedId);
  const row = props.rows[index];
  const mod = event.metaKey || event.ctrlKey;
  const step = (delta: number) => {
    const next = props.rows[Math.min(props.rows.length - 1, Math.max(0, index + delta))];
    if (next) emit('select', next.id);
  };
  const edit = (fn: (id: string) => void) => {
    event.preventDefault();
    if (!props.readOnly && row && row.depth > 0) fn(row.id);
  };
  if (event.altKey && event.key === 'ArrowUp') edit((id) => emit('shift', id, -1));
  else if (event.altKey && event.key === 'ArrowDown') edit((id) => emit('shift', id, 1));
  else if (event.altKey && event.key === 'ArrowRight') edit((id) => emit('indent', id));
  else if (event.altKey && event.key === 'ArrowLeft') edit((id) => emit('outdent', id));
  else if (event.key === 'ArrowDown') {
    event.preventDefault();
    step(index < 0 ? 0 : 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    step(index < 0 ? 0 : -1);
  } else if (event.key === 'Delete' || event.key === 'Backspace') edit((id) => emit('remove', id));
  else if (mod && event.key.toLowerCase() === 'd') edit((id) => emit('duplicate', id));
  else if (event.key === 'F2' && row) {
    event.preventDefault();
    void startRename(row);
  } else if (event.key === 'Escape' && props.selectedId) {
    event.preventDefault();
    emit('select', null);
  }
}

const dropClass = (row: OutlineRow) => {
  if (drop.value?.id !== row.id) return '';
  if (drop.value.position === 'inside')
    return 'ws:shadow-[inset_0_0_0_1px_var(--ws-color-brand-500)] ws:ring-2 ws:ring-brand-500/30';
  return drop.value.position === 'before'
    ? 'ws:shadow-[inset_0_2px_0_var(--ws-color-brand-500)]'
    : 'ws:shadow-[inset_0_-2px_0_var(--ws-color-brand-500)]';
};
</script>

<template>
  <div>
    <ul
      ref="tree"
      role="tree"
      aria-label="Elements"
      tabindex="0"
      class="ws:space-y-px ws:rounded-control ws:outline-offset-2 ws:focus-visible:outline-2 ws:focus-visible:outline-brand-500"
      @keydown="onKeydown"
      @mouseleave="emit('hover', null)"
    >
      <li
        v-for="row in rows"
        :key="row.id"
        role="treeitem"
        :aria-selected="row.id === selectedId"
        :aria-level="row.depth + 1"
        :aria-expanded="row.childCount ? !collapsed.has(row.id) : undefined"
        class="mb-list-item mb-list-item-sm group ws:cursor-pointer ws:pr-1"
        :class="[
          row.id === selectedId ? 'mb-list-item-active' : row.id === hoveredId ? 'ws:bg-surface-100 ws:dark:bg-surface-800' : '',
          dragging === row.id ? 'ws:opacity-40' : '',
          dropClass(row),
        ]"
        :style="{ paddingLeft: `${0.25 + row.depth * 0.9}rem` }"
        :draggable="!readOnly && row.depth > 0 && renaming !== row.id"
        @click="emit('select', row.id)"
        @dblclick="startRename(row)"
        @mouseenter="emit('hover', row.id)"
        @dragstart="onDragStart($event, row.id)"
        @dragend="onDragEnd"
        @dragover="onDragOver($event, row)"
        @dragleave="drop?.id === row.id ? (drop = null) : undefined"
        @drop="onDrop($event, row)"
      >
        <button
          v-if="row.childCount > 0"
          type="button"
          class="ws:shrink-0 ws:rounded-sm ws:text-surface-500"
          :aria-label="collapsed.has(row.id) ? 'Expand' : 'Collapse'"
          tabindex="-1"
          @click.stop="emit('toggle', row.id)"
        >
          <Icon :name="collapsed.has(row.id) ? 'chevron' : 'down'" class="mb-icon-sm" />
        </button>
        <span v-else class="mb-icon-sm ws:shrink-0" />

        <input
          v-if="renaming === row.id"
          ref="renameInput"
          v-model="renameText"
          class="mb-input mb-input-sm ws:min-w-0 ws:flex-1"
          :aria-label="`Name of ${row.label}`"
          maxlength="100"
          @click.stop
          @keydown.enter.prevent="finishRename(true)"
          @keydown.escape.prevent="finishRename(false)"
          @blur="finishRename(true)"
        />
        <Icon v-if="renaming !== row.id" :name="ELEMENT_ICONS[row.el]" class="mb-icon-sm ws:shrink-0 ws:text-surface-400" />
        <span v-if="renaming !== row.id" class="ws:min-w-0 ws:flex-1 ws:truncate" :title="row.label">{{ row.label }}</span>
        <span class="ws:shrink-0 ws:text-2xs ws:text-surface-500">{{ ELEMENT_LABELS[row.el] }}</span>

        <!-- Adds a child; the pane fills it with the element palette. -->
        <span v-if="!readOnly && row.container" class="ws:contents" @click.stop>
          <slot name="add" :row="row" :active="row.id === selectedId" />
        </span>

        <template v-if="!readOnly && row.depth > 0">
          <button
            type="button"
            class="ws:rounded-sm ws:p-0.5 ws:text-surface-500 ws:hover:text-brand-600"
            :class="{ 'mb-row-action': row.id !== selectedId }"
            tabindex="-1"
            :aria-label="`Duplicate ${row.label}`"
            title="Duplicate (Ctrl+D)"
            @click.stop="emit('duplicate', row.id)"
          >
            <Icon name="copy" class="mb-icon-sm" />
          </button>
          <IconButton
            icon="trash"
            :label="`Delete ${row.label}`"
            title="Delete (Del)"
            danger
            class="ws:-my-1"
            :class="{ 'mb-row-action': row.id !== selectedId }"
            tabindex="-1"
            @click.stop="emit('remove', row.id)"
          />
        </template>
      </li>
    </ul>
    <p v-if="!readOnly" class="ws:mt-2 ws:flex ws:items-center ws:gap-1.5 ws:text-2xs ws:text-surface-500">
      <span class="ws:flex-1">Drag rows to reorder or nest them. Double-click to rename.</span>
      <span
        class="ws:inline-flex ws:cursor-help ws:items-center ws:gap-1 ws:rounded-control ws:px-1 ws:py-0.5 ws:hover:bg-surface-100 ws:dark:hover:bg-surface-800"
        tabindex="0"
        title="Alt+Up/Down moves, Alt+Right/Left nests and un-nests, F2 renames, Ctrl+D duplicates, Del deletes"
        aria-label="Keyboard shortcuts: Alt+Up/Down moves, Alt+Right/Left nests and un-nests, F2 renames, Ctrl+D duplicates, Del deletes"
      >
        <Icon name="keyboard" class="mb-icon-sm" /> Keys
      </span>
    </p>
  </div>
</template>
