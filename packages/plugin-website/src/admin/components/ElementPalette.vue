<script setup lang="ts">
import { FeatureLock, Icon, SearchField, useFeature } from '@manablox/admin-sdk';
import {
  type ElementKind,
  PALETTE_TYPE,
  paletteKindType,
  type SiteDesignKind,
} from '@manablox/site';
import { computed, ref } from 'vue';
import { ELEMENT_HINTS, ELEMENT_ICONS, ELEMENT_LABELS, paletteGroups } from '../model/elements';

/**
 * Elements to add: click inserts after the selection, dragging onto the canvas drops one
 * where it lands. `unavailable` lists kinds with a reason, e.g. no field to show.
 */
const props = defineProps<{
  designKind: SiteDesignKind;
  unavailable?: Partial<Record<ElementKind, string>> | undefined;
  disabled?: boolean;
  /** Where a click puts the element; below the selection by default. */
  target?: string | undefined;
}>();
const emit = defineEmits<{ insert: [kind: ElementKind] }>();

const query = ref('');
/**
 * Form elements follow `plugins.website.forms`: hidden drops the group, locked disables it.
 * Setting up forms locked disables them too.
 */
const forms = useFeature('plugins.website.forms');
const formsConfig = useFeature('plugins.website.forms.config');
const isForm = (kinds: readonly ElementKind[]) => kinds.includes('form');
const groups = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return paletteGroups(props.designKind)
    .filter((group) => !(forms.value.hidden && isForm(group.kinds)))
    .map((group) => ({
      ...group,
      kinds: needle
        ? group.kinds.filter((kind) =>
            `${ELEMENT_LABELS[kind]} ${ELEMENT_HINTS[kind] ?? ''}`.toLowerCase().includes(needle),
          )
        : group.kinds,
    }))
    .filter((group) => group.kinds.length > 0);
});
const FORM_KINDS = new Set<ElementKind>(['form', 'formField', 'formSubmit', 'formMessage']);
const formsReason = () => {
  if (forms.value.locked) return 'Site forms are locked';
  return formsConfig.value.enabled ? undefined : 'Setting up site forms is locked';
};
const reason = (kind: ElementKind) =>
  props.unavailable?.[kind] ?? (FORM_KINDS.has(kind) ? formsReason() : undefined);

function onDragStart(event: DragEvent, kind: ElementKind) {
  if (props.disabled || reason(kind) || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData(PALETTE_TYPE, kind);
  event.dataTransfer.setData(paletteKindType(kind), kind);
  event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div class="ws:space-y-3">
    <p class="mb-meta">
      Drag an element onto the preview, or click it to add it {{ target ?? 'below the selected one' }}.
    </p>
    <SearchField v-model="query" label="Find an element" placeholder="Find an element" size="sm" :debounce="0" />
    <p v-if="groups.length === 0" class="ws:py-4 ws:text-center mb-meta">No element matches "{{ query }}".</p>
    <section v-for="group in groups" :key="group.label" class="ws:space-y-1">
      <h3 class="ws:flex ws:items-baseline ws:justify-between ws:gap-2">
        <span class="ws:flex ws:items-center ws:gap-1 ws:text-xs ws:font-semibold ws:text-surface-700 ws:dark:text-surface-300">
          {{ group.label }}
          <FeatureLock v-if="forms.locked && isForm(group.kinds)" feature="plugins.website.forms" :state="forms" />
        </span>
        <span class="ws:truncate ws:text-2xs ws:text-surface-500">{{ group.hint }}</span>
      </h3>
      <div class="ws:grid ws:gap-0.5">
        <button
          v-for="kind in group.kinds"
          :key="kind"
          type="button"
          class="group ws:group ws:flex ws:w-full ws:items-center ws:gap-2.5 ws:rounded-control ws:px-1.5 ws:py-1 ws:text-left ws:transition-colors ws:enabled:hover:bg-surface-100 ws:disabled:opacity-50 ws:dark:enabled:hover:bg-surface-800"
          :class="disabled || reason(kind) ? 'ws:cursor-not-allowed' : 'ws:cursor-grab ws:active:cursor-grabbing'"
          :disabled="disabled || Boolean(reason(kind))"
          :draggable="!disabled && !reason(kind)"
          :aria-label="ELEMENT_LABELS[kind]"
          :aria-description="reason(kind) ?? ELEMENT_HINTS[kind]"
          :title="reason(kind) ?? 'Drag onto the preview, or click to add'"
          @click="emit('insert', kind)"
          @dragstart="onDragStart($event, kind)"
        >
          <span class="ws:flex ws:h-7 ws:w-7 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-control ws:border ws:border-surface-200 ws:bg-surface-50 ws:text-surface-600 ws:group-enabled:group-hover:border-brand-300 ws:group-enabled:group-hover:text-brand-600 ws:dark:border-surface-700 ws:dark:bg-surface-800 ws:dark:text-surface-300">
            <Icon :name="ELEMENT_ICONS[kind]" class="mb-icon-sm" />
          </span>
          <span class="ws:min-w-0 ws:flex-1">
            <span class="ws:block ws:truncate ws:text-sm ws:font-medium">{{ ELEMENT_LABELS[kind] }}</span>
            <span class="ws:block ws:truncate ws:text-2xs ws:text-surface-500">{{ reason(kind) ?? ELEMENT_HINTS[kind] }}</span>
          </span>
          <Icon v-if="!disabled && !reason(kind)" name="drag" class="mb-row-action mb-icon-sm ws:shrink-0 ws:text-surface-300 ws:dark:text-surface-600" />
        </button>
      </div>
    </section>
  </div>
</template>
