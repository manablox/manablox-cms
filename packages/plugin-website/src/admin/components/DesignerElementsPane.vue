<script setup lang="ts">
import { Icon, Popover } from '@manablox/admin-sdk';
import type { ElementKind, SiteDesignKind } from '@manablox/site';
import { ref } from 'vue';
import type { OutlineRow } from '../model/outline';
import type { Designer } from '../useDesigner';
import DesignOutline from './DesignOutline.vue';
import ElementPalette from './ElementPalette.vue';

/**
 * The left pane of the element designers: the Layers outline, with the element palette
 * in an Add menu and behind each container row's plus. The `top` slot sits above, e.g. the
 * block's variants.
 */
const props = defineProps<{
  designer: Designer;
  designKind: SiteDesignKind;
  unavailable?: Partial<Record<ElementKind, string>>;
  readOnly: boolean;
}>();

const adding = ref(false);
/** The container row whose plus is open. */
const addingTo = ref<string | null>(null);

function insert(kind: ElementKind) {
  if (props.designer.insert(kind)) adding.value = false;
}

function openChild(row: OutlineRow, open: boolean) {
  // The palette's reasons follow the selection, so the row becomes it.
  if (open) props.designer.select(row.id);
  addingTo.value = open ? row.id : null;
}

function insertChild(row: OutlineRow, kind: ElementKind) {
  if (props.designer.insert(kind, { parentId: row.id, index: row.childCount })) {
    addingTo.value = null;
  }
}
</script>

<template>
  <slot name="top" />
  <div class="ws:space-y-2">
    <div class="ws:flex ws:items-center ws:justify-between ws:gap-2">
      <h2 class="ws:flex ws:items-center ws:gap-1.5 ws:text-sm ws:font-semibold">
        <Icon name="layers" class="mb-icon-sm ws:text-surface-500" /> Layers
      </h2>
      <Popover v-if="!readOnly" v-model:open="adding" align="end" class="ws:w-80 ws:overflow-y-auto ws:p-3">
        <template #trigger>
          <button type="button" class="mb-btn-outline mb-btn-sm" :aria-expanded="adding">
            <Icon name="plus" class="mb-icon-sm" /> Add <Icon name="down" class="mb-icon-sm ws:text-surface-400" />
          </button>
        </template>
        <ElementPalette :design-kind="designKind" :unavailable="unavailable" @insert="insert" />
      </Popover>
    </div>
    <DesignOutline
      :rows="designer.rows.value"
      :selected-id="designer.selectedId.value"
      :hovered-id="designer.hoveredId.value"
      :collapsed="designer.collapsed.value"
      :read-only="readOnly"
      :can-place="designer.canPlace"
      @select="designer.select"
      @hover="designer.hover"
      @toggle="designer.toggleCollapsed"
      @place="designer.place"
      @remove="designer.remove"
      @duplicate="designer.duplicate"
      @rename="designer.rename"
      @shift="designer.shift"
      @indent="designer.indent"
      @outdent="designer.outdent"
    >
      <template #add="{ row, active }">
        <Popover
          :open="addingTo === row.id"
          align="start"
          side="right"
          class="ws:w-80 ws:overflow-y-auto ws:p-3"
          @update:open="openChild(row, $event)"
        >
          <template #trigger>
            <button
              type="button"
              class="ws:rounded-sm ws:p-0.5 ws:text-surface-500 ws:hover:text-brand-600"
              :class="{ 'mb-row-action': !active && addingTo !== row.id }"
              tabindex="-1"
              :aria-label="`Add an element inside ${row.label}`"
              title="Add inside"
            >
              <Icon name="plus" class="mb-icon-sm" />
            </button>
          </template>
          <ElementPalette
            :design-kind="designKind"
            :unavailable="unavailable"
            :target="`inside ${row.label}, at the end`"
            @insert="insertChild(row, $event)"
          />
        </Popover>
      </template>
    </DesignOutline>
  </div>
</template>
