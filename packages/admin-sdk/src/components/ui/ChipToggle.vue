<script setup lang="ts">
/** Multi-select as toggle chips backed by hidden checkboxes; `mono` for codes. */
const model = defineModel<boolean>({ required: true });
withDefaults(defineProps<{ disabled?: boolean; mono?: boolean }>(), {
  disabled: false,
  mono: false,
});
</script>

<template>
  <label
    class="mb-badge"
    :class="[model ? 'mb-badge-brand' : '', mono ? 'font-mono' : '', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']"
  >
    <input
      type="checkbox"
      class="sr-only"
      :checked="model"
      :disabled="disabled"
      @change="model = !model"
    />
    <slot />
  </label>
</template>
