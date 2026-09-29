<script setup lang="ts" generic="T extends string | number | boolean">
/** One radio of a group; checked while the model equals `value`. The default slot is its label. */
const model = defineModel<T>({ required: true });
withDefaults(
  defineProps<{
    value: T;
    /** Groups radios for the keyboard. */
    name: string;
    disabled?: boolean;
    id?: string | undefined;
  }>(),
  { disabled: false },
);
</script>

<template>
  <label class="flex items-center gap-2 text-sm">
    <input
      :id="id"
      type="radio"
      :name="name"
      :checked="model === value"
      :disabled="disabled"
      @change="model = value"
    />
    <slot />
  </label>
</template>
