<script setup lang="ts" generic="T extends string | number">
import Icon from '../Icon.vue';
import type { SegmentedOption } from './types';

/** Single-choice segmented control; `columns` renders a full-width grid. */

export type { SegmentedOption };

const model = defineModel<T>({ required: true });
withDefaults(
  defineProps<{
    options: readonly SegmentedOption<T>[];
    /** Use `labelledby` instead when a visible label exists. */
    ariaLabel?: string | undefined;
    labelledby?: string | undefined;
    disabled?: boolean;
    iconOnly?: boolean;
    columns?: number | undefined;
  }>(),
  { disabled: false, iconOnly: false },
);
/** Every click, the current option included. */
const emit = defineEmits<{ select: [value: T] }>();

function pick(value: T) {
  model.value = value;
  emit('select', value);
}
</script>

<template>
  <div
    class="rounded-control bg-surface-100 p-0.5 dark:bg-surface-800"
    :class="columns ? 'grid gap-1' : 'flex items-center gap-0.5'"
    :style="columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined"
    role="group"
    :aria-label="ariaLabel"
    :aria-labelledby="labelledby"
  >
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="mb-segment"
      :class="[
        option.hint ? 'mb-segment-stacked' : iconOnly ? 'mb-segment-icon' : '',
        model === option.value ? 'mb-segment-active' : '',
      ]"
      :disabled="disabled"
      :aria-pressed="model === option.value"
      :aria-label="iconOnly ? option.label : undefined"
      :title="iconOnly ? option.label : undefined"
      @click="pick(option.value)"
    >
      <Icon v-if="option.icon" :name="option.icon" class="mb-icon-sm shrink-0" />
      <template v-if="!iconOnly">
        <span :class="option.hint ? 'block' : ''">{{ option.label }}</span>
        <span v-if="option.hint" class="block text-2xs font-normal opacity-70">{{ option.hint }}</span>
      </template>
    </button>
  </div>
</template>
