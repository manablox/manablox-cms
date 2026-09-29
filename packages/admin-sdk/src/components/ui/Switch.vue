<script setup lang="ts">
/** Toggle switch; the default slot is its label. */
const model = defineModel<boolean>({ required: true });
withDefaults(
  defineProps<{
    disabled?: boolean;
    /** Accessible name when there is no label slot. */
    ariaLabel?: string | undefined;
    compact?: boolean;
    id?: string | undefined;
  }>(),
  { disabled: false, compact: false },
);
</script>

<template>
  <component
    :is="$slots.default ? 'label' : 'span'"
    class="inline-flex items-center gap-2 text-sm"
    :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
  >
    <button
      :id="id"
      type="button"
      role="switch"
      class="mb-switch"
      :class="compact ? 'mb-switch-sm' : ''"
      :aria-checked="model"
      :aria-label="ariaLabel"
      :disabled="disabled"
      @click="model = !model"
    >
      <span class="mb-switch-thumb" />
    </button>
    <span v-if="$slots.default" class="min-w-0"><slot /></span>
  </component>
</template>
