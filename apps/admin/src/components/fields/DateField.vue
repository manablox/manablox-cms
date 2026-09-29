<script setup lang="ts">
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const mode = computed(() => (props.settings.mode as string) ?? 'datetime');

/** Converts between `datetime-local` input format and the stored ISO instant. */
const value = computed({
  get: () => {
    const raw = typeof props.modelValue === 'string' ? props.modelValue : '';
    if (!raw) return '';
    return mode.value === 'date' ? raw.slice(0, 10) : raw.slice(0, 16);
  },
  set: (next: string) => {
    if (!next) return emit('update:modelValue', '');
    emit('update:modelValue', mode.value === 'date' ? next : new Date(next).toISOString());
  },
});
</script>

<template>
  <input
    :id="id"
    v-model="value"
    :type="mode === 'date' ? 'date' : 'datetime-local'"
    class="mb-input"
    :min="settings.min as string | undefined"
    :max="settings.max as string | undefined"
  />
</template>
