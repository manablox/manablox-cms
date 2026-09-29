<script setup lang="ts">
import { FeatureLock, Icon, useSessionStore, useSpaceStore } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { WorkflowActionMeta } from '../../sdk';
import {
  actionFeature,
  CONTROL_NODE_LIST,
  type ControlNodeKind,
  PALETTE_DRAG_TYPE,
  type PaletteEntry,
  toneClass,
} from '../model';
import type { WorkflowCatalog } from '../queries';

/** Addable nodes: the control nodes, then every installed action by catalogue group. Click to join the chain, or drag onto the canvas. */
const props = defineProps<{ catalog: WorkflowCatalog | undefined }>();
const emit = defineEmits<{
  action: [meta: WorkflowActionMeta];
  add: [kind: ControlNodeKind];
}>();

const search = ref('');

const session = useSessionStore();
const spaces = useSpaceStore();
/** The flag an action is behind when it is off; hidden ones leave the palette. */
function offFeature(action: WorkflowActionMeta) {
  const key = actionFeature(action.type, action);
  if (!key) return null;
  const state = session.feature(key, spaces.currentId);
  return state.enabled ? null : { key, state };
}

function startDrag(event: DragEvent, entry: PaletteEntry) {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(PALETTE_DRAG_TYPE, JSON.stringify(entry));
  event.dataTransfer.effectAllowed = 'copy';
}

const groups = computed(() => {
  const term = search.value.trim().toLowerCase();
  const matches = (action: WorkflowActionMeta) =>
    !term ||
    action.label.toLowerCase().includes(term) ||
    action.description.toLowerCase().includes(term) ||
    action.type.includes(term);

  return (props.catalog?.actionGroups ?? [])
    .map((group) => ({
      ...group,
      actions: (props.catalog?.actions ?? [])
        .filter(
          (action) =>
            action.group === group.id && matches(action) && !offFeature(action)?.state.hidden,
        )
        .map((action) => ({ action, off: offFeature(action) })),
    }))
    .filter((group) => group.actions.length);
});

const controls = computed(() => {
  const term = search.value.trim().toLowerCase();
  return CONTROL_NODE_LIST.filter(
    (entry) =>
      !term ||
      `${entry.label} ${entry.description} ${entry.kind} ${entry.keywords}`
        .toLowerCase()
        .includes(term),
  );
});
</script>

<template>
  <div class="wf:flex wf:h-full wf:flex-col">
    <div class="wf:p-3 wf:pb-2">
      <input v-model="search" class="mb-input" placeholder="Search actions" aria-label="Search actions" />
    </div>

    <div class="wf:min-h-0 wf:flex-1 wf:overflow-auto wf:px-2 wf:pb-3">
      <div v-if="controls.length" class="wf:mb-3">
        <p class="wf:px-1.5 wf:pb-1 wf:text-2xs wf:font-semibold wf:uppercase wf:tracking-wide wf:text-surface-500">Decide, repeat and wait</p>
        <button
          v-for="entry in controls"
          :key="entry.kind"
          type="button"
          class="wf-palette-item"
          :title="entry.description"
          draggable="true"
          @click="emit('add', entry.kind)"
          @dragstart="startDrag($event, { kind: 'control', control: entry.kind })"
        >
          <span class="wf:flex wf:h-7 wf:w-7 wf:shrink-0 wf:items-center wf:justify-center wf:rounded-control" :class="toneClass(entry.tone)">
            <Icon :name="entry.icon" class="mb-icon-sm" />
          </span>
          <span class="wf:min-w-0 wf:flex-1">
            <span class="wf:block wf:truncate wf:text-sm wf:font-medium">{{ entry.label }}</span>
            <span class="wf:block wf:truncate mb-meta">{{ entry.description }}</span>
          </span>
        </button>
      </div>

      <div v-for="group in groups" :key="group.id" class="wf:mb-3">
        <p class="wf:px-1.5 wf:pb-1 wf:text-2xs wf:font-semibold wf:uppercase wf:tracking-wide wf:text-surface-500">{{ group.label }}</p>
        <template v-for="{ action, off } in group.actions" :key="action.type">
          <FeatureLock
            v-if="off"
            :feature="off.key"
            :state="off.state"
            :label="action.label"
            trigger-class="wf-palette-item wf:text-sm wf:font-medium"
          />
          <button
            v-else
            type="button"
            class="wf-palette-item"
            :title="action.available ? action.description : (action.unavailable ?? '')"
            draggable="true"
            @click="emit('action', action)"
            @dragstart="startDrag($event, { kind: 'action', type: action.type })"
          >
            <span class="wf:flex wf:h-7 wf:w-7 wf:shrink-0 wf:items-center wf:justify-center wf:rounded-control" :class="toneClass(action.tone)">
              <Icon :name="action.icon" class="mb-icon-sm" />
            </span>
            <span class="wf:min-w-0 wf:flex-1">
              <span class="wf:flex wf:items-center wf:gap-1.5">
                <span class="wf:min-w-0 wf:truncate wf:text-sm wf:font-medium">{{ action.label }}</span>
                <Icon
                  v-if="!action.available"
                  name="alert"
                  class="mb-icon-sm wf:shrink-0 wf:text-warn-600"
                  :title="action.unavailable ?? ''"
                />
              </span>
              <span class="wf:block wf:truncate mb-meta">{{ action.description }}</span>
            </span>
          </button>
        </template>
      </div>

      <p v-if="!groups.length && !controls.length" class="wf:px-2 wf:py-6 wf:text-center wf:text-sm wf:text-surface-500">
        Nothing matches "{{ search }}".
      </p>
    </div>
  </div>
</template>
