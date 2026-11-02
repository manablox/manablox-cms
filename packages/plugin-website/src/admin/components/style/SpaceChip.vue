<script setup lang="ts">
import { Icon, Popover } from '@manablox/admin-sdk';
import { parseTokenRef, type ThemeDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import type { BoxSide } from '../../model/style-visual';
import ChoiceTiles from './ChoiceTiles.vue';
import SpaceScale from './SpaceScale.vue';

/**
 * A spacing value as a small chip; clicking opens the scale. With `scopes`, the popover
 * also asks how far the change reaches (one side, both, all).
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | undefined;
    inherited?: string | undefined;
    theme: ThemeDesign;
    label: string;
    extra?: readonly string[] | undefined;
    /** `sides` are drawn highlighted on the scope's tile. */
    scopes?:
      | ReadonlyArray<{ value: string; label: string; title?: string; sides: readonly BoxSide[] }>
      | undefined;
    scope?: string | undefined;
    disabled?: boolean;
    /** Wider chip for rows outside the box diagram. */
    wide?: boolean;
  }>(),
  { disabled: false, wide: false },
);
const emit = defineEmits<{
  pick: [value: string | undefined, scope: string | undefined];
}>();

const open = ref(false);
const chosenScope = ref(props.scope);

function onOpen(value: boolean) {
  if (value) chosenScope.value = props.scope;
  open.value = value;
}

const shown = computed(() => props.modelValue ?? props.inherited);
const text = computed(() => {
  const value = shown.value;
  if (value === undefined) return '-';
  if (value === '0') return '0';
  return parseTokenRef(value)?.name ?? value;
});
const px = computed(() => {
  const ref = parseTokenRef(shown.value);
  return ref?.group === 'space' ? props.theme.space[ref.name] : undefined;
});

/** Edges of a 20px box, drawn as lines. */
const EDGES: Record<BoxSide, { x1: number; y1: number; x2: number; y2: number }> = {
  top: { x1: 3, y1: 3, x2: 17, y2: 3 },
  right: { x1: 17, y1: 3, x2: 17, y2: 17 },
  bottom: { x1: 3, y1: 17, x2: 17, y2: 17 },
  left: { x1: 3, y1: 3, x2: 3, y2: 17 },
};

const covers = (scope: string, side: BoxSide) =>
  props.scopes?.find((entry) => entry.value === scope)?.sides.includes(side) ?? false;

/** Pressing the chosen tile again keeps it. */
function chooseScope(value: string | undefined) {
  if (value) chosenScope.value = value;
}

function pick(value: string | undefined) {
  emit('pick', value, chosenScope.value);
  open.value = false;
}
</script>

<template>
  <Popover :open="open" class="ws:w-72 ws:space-y-2 ws:p-2" @update:open="onOpen">
    <template #trigger>
      <button
        type="button"
        class="ws:inline-flex ws:items-center ws:justify-center ws:gap-1 ws:rounded-control ws:font-mono ws:text-xs ws:tabular-nums ws:transition-colors ws:hover:bg-surface-0/80 ws:focus-visible:outline-2 ws:focus-visible:outline-brand-500 ws:disabled:opacity-50 ws:dark:hover:bg-surface-900/80"
        :class="[
          wide ? 'mb-control ws:w-full ws:justify-between' : 'ws:h-6 ws:min-w-8 ws:px-1.5',
          modelValue !== undefined ? 'ws:font-semibold ws:text-surface-900 ws:dark:text-surface-50' : 'ws:text-surface-400',
        ]"
        :aria-label="`${label}: ${shown === undefined ? 'theme default' : text}${modelValue === undefined && inherited ? ' (inherited)' : ''}`"
        :title="`${label}: ${shown === undefined ? 'theme default' : `${text}${px ? ` (${px})` : ''}`}`"
        :disabled="disabled"
      >
        <span>{{ text }}</span>
        <span v-if="wide && px" class="ws:text-2xs ws:font-normal ws:text-surface-500">{{ px }}</span>
        <Icon v-if="wide" name="down" class="mb-icon-sm ws:text-surface-400" />
      </button>
    </template>
    <p class="ws:text-xs ws:font-semibold">{{ label }}</p>
    <ChoiceTiles
      v-if="scopes && chosenScope"
      :model-value="chosenScope"
      :options="scopes"
      :columns="scopes.length"
      labelled
      group-label="Applies to"
      @update:model-value="chooseScope"
    >
      <template #tile="{ option }">
        <svg viewBox="0 0 20 20" class="ws:size-5" aria-hidden="true">
          <line
            v-for="(edge, side) in EDGES"
            :key="side"
            v-bind="edge"
            stroke="currentColor"
            stroke-linecap="round"
            :stroke-width="covers(option.value, side) ? 2.5 : 1"
            :opacity="covers(option.value, side) ? 1 : 0.35"
          />
        </svg>
      </template>
    </ChoiceTiles>
    <SpaceScale :model-value="modelValue" :theme="theme" :extra="extra" :inherited="inherited" @pick="pick" />
    <button type="button" class="mb-btn-ghost mb-btn-sm ws:w-full ws:justify-center" :disabled="modelValue === undefined" @click="pick(undefined)">
      <Icon name="reset" class="mb-icon-sm" /> {{ inherited ? 'Inherit' : 'Use the theme default' }}
    </button>
  </Popover>
</template>
