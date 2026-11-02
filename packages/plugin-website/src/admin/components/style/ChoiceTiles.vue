<script setup lang="ts" generic="V extends string | number | boolean">
import { Icon } from '@manablox/admin-sdk';

/**
 * A row of pressable tiles for one style value; the `tile` slot draws what an option looks
 * like. Pressing the chosen tile again unsets the value. The inherited option gets a
 * dashed frame.
 */
const props = withDefaults(
  defineProps<{
    modelValue: V | undefined;
    options: ReadonlyArray<{ value: V; label: string; icon?: string; title?: string }>;
    inherited?: V | undefined;
    columns?: number;
    /** Tall tiles with the label under the drawing. */
    labelled?: boolean;
    groupLabel: string;
    disabled?: boolean;
  }>(),
  { columns: 4, labelled: false, disabled: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: V | undefined] }>();

function press(value: V) {
  if (props.disabled) return;
  emit('update:modelValue', props.modelValue === value ? undefined : value);
}
</script>

<template>
  <div role="group" :aria-label="groupLabel" class="ws:grid ws:gap-1" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="group ws:flex ws:min-w-0 ws:flex-col ws:items-center ws:justify-center ws:gap-1 ws:rounded-control ws:border ws:px-1 ws:text-surface-600 ws:transition-colors ws:disabled:opacity-50 ws:dark:text-surface-300"
      :class="[
        labelled ? 'ws:py-1.5' : 'ws:h-8',
        modelValue === option.value
          ? 'ws:border-brand-500 ws:bg-brand-50 ws:text-brand-700 ws:dark:bg-brand-900/30 ws:dark:text-brand-200'
          : inherited === option.value && modelValue === undefined
            ? 'ws:border-dashed ws:border-surface-400 ws:bg-surface-0 ws:dark:border-surface-500 ws:dark:bg-surface-900'
            : 'ws:border-surface-200 ws:bg-surface-0 ws:hover:border-surface-300 ws:hover:bg-surface-50 ws:dark:border-surface-700 ws:dark:bg-surface-900 ws:dark:hover:bg-surface-800',
      ]"
      :aria-pressed="modelValue === option.value"
      :aria-label="option.label"
      :title="`${option.title ?? option.label}${inherited === option.value && modelValue === undefined ? ' (inherited)' : ''}`"
      :disabled="disabled"
      @click="press(option.value)"
    >
      <slot name="tile" :option="option" :active="modelValue === option.value">
        <Icon v-if="option.icon" :name="option.icon" class="mb-icon-sm" />
        <span v-else class="ws:max-w-full ws:truncate ws:text-xs ws:font-medium">{{ option.label }}</span>
      </slot>
      <span v-if="labelled" class="ws:line-clamp-2 ws:max-w-full ws:text-center ws:text-2xs ws:leading-tight">{{ option.label }}</span>
    </button>
  </div>
</template>
