<script setup lang="ts">
/** Checkbox with a title and hint. */
const model = defineModel<boolean>({ required: true });
withDefaults(
  defineProps<{
    title: string;
    hint?: string | undefined;
    disabled?: boolean;
    id?: string | undefined;
    /** Bordered card style, highlighted when checked. */
    bordered?: boolean;
  }>(),
  { disabled: false, bordered: false },
);
</script>

<template>
  <label
    class="flex items-start gap-2 text-sm"
    :class="[
      disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      bordered ? 'rounded-control border px-3 py-2 transition' : '',
      bordered && model ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-600/15' : '',
      bordered && !model ? 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600' : '',
    ]"
  >
    <input
      :id="id"
      type="checkbox"
      class="mt-0.5"
      :checked="model"
      :disabled="disabled"
      @change="model = !model"
    />
    <span class="min-w-0">
      <span class="block font-medium">{{ title }}</span>
      <span v-if="hint" class="block text-2xs text-surface-500">{{ hint }}</span>
    </span>
  </label>
</template>
