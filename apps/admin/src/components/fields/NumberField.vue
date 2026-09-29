<script setup lang="ts">
import NumberInput from '@manablox/admin-sdk/components/ui/NumberField.vue';
import { computed } from 'vue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [number | null] }>();

const value = computed(() => (typeof props.modelValue === 'number' ? props.modelValue : null));
const bound = (key: string) =>
  typeof props.settings[key] === 'number' ? (props.settings[key] as number) : undefined;
</script>

<template>
  <!-- Empty is null, not 0. -->
  <NumberInput
    :id="id"
    :model-value="value"
    nullable
    :mode="settings.integer ? 'integer' : 'decimal'"
    :min="bound('min')"
    :max="bound('max')"
    :step="bound('step')"
    @update:model-value="emit('update:modelValue', $event ?? null)"
  />
</template>
