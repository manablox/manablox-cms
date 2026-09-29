<script setup lang="ts">
import { computed, useId } from 'vue';

/** Label, hint and error around one control; the default slot receives the control's id. */
const props = withDefaults(
  defineProps<{
    label?: string | undefined;
    /** Fixed id for the control; generated when absent. */
    id?: string | undefined;
    hint?: string | undefined;
    error?: string | null | false | undefined;
    /** Shows the required marker after the label. */
    required?: boolean;
  }>(),
  { required: false },
);

const generated = useId();
const id = computed(() => props.id ?? generated);
</script>

<template>
  <div>
    <div v-if="$slots.actions" class="flex items-start justify-between gap-2">
      <label class="mb-label" :for="id">
        <slot name="label">{{ label }}</slot>
        <span v-if="required" class="text-danger-500"> *</span>
      </label>
      <slot name="actions" />
    </div>
    <label v-else-if="label || $slots.label" class="mb-label" :for="id">
      <slot name="label">{{ label }}</slot>
      <span v-if="required" class="text-danger-500"> *</span>
    </label>
    <slot :id="id" />
    <p v-if="hint" class="mb-hint">{{ hint }}</p>
    <slot name="hint" />
    <p v-if="error" class="mb-error">{{ error }}</p>
    <slot name="error" />
  </div>
</template>
