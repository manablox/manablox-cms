<script setup lang="ts">
/** Checkbox with its label as the default slot; a bare, aria-labelled box without one. Every change emits the flip. */
const model = defineModel<boolean>({ required: true });
withDefaults(
  defineProps<{
    disabled?: boolean;
    indeterminate?: boolean;
    /** Accessible name when there is no label slot. */
    ariaLabel?: string | undefined;
    id?: string | undefined;
    /** Top-aligns the box next to multi-line text. */
    align?: 'center' | 'start';
  }>(),
  { disabled: false, indeterminate: false, align: 'center' },
);
</script>

<template>
  <label v-if="$slots.default" class="flex gap-2 text-sm" :class="align === 'start' ? 'items-start' : 'items-center'">
    <input
      :id="id"
      type="checkbox"
      :class="align === 'start' ? 'mt-0.5' : ''"
      :checked="model"
      :indeterminate="indeterminate"
      :disabled="disabled"
      @change="model = !model"
    />
    <slot />
  </label>
  <input
    v-else
    :id="id"
    type="checkbox"
    :checked="model"
    :indeterminate="indeterminate"
    :disabled="disabled"
    :aria-label="ariaLabel"
    @change="model = !model"
  />
</template>
