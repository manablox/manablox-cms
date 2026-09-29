<script setup lang="ts" generic="T extends string | number | boolean">
/** Bordered radio with a title and hint, highlighted while chosen. */
const model = defineModel<T>({ required: true });
withDefaults(
  defineProps<{
    value: T;
    /** Groups radios for the keyboard. */
    name: string;
    title: string;
    hint?: string | undefined;
    disabled?: boolean;
    id?: string | undefined;
  }>(),
  { disabled: false },
);
</script>

<template>
  <label
    class="flex items-start gap-2 rounded-control border px-3 py-2 text-sm transition"
    :class="[
      disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      model === value
        ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-600/15'
        : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600',
    ]"
  >
    <input
      :id="id"
      type="radio"
      class="mt-0.5"
      :name="name"
      :checked="model === value"
      :disabled="disabled"
      @change="model = value"
    />
    <span class="min-w-0">
      <span class="block font-medium">{{ title }}</span>
      <span v-if="hint" class="block text-2xs text-surface-500">{{ hint }}</span>
    </span>
  </label>
</template>
