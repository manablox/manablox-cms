<script setup lang="ts">
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { toggleInList } from '@manablox/admin-sdk/lib/collections';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { computed } from 'vue';
import { useRelationValue } from '~/composables/useRelationValue';
import type { FieldInputProps } from '~/lib/field-input';

interface Option {
  value: string;
  label?: string;
}

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string | string[]] }>();

const context = useFieldContext();
const options = computed(() => (props.settings.options as Option[]) ?? []);
const { ids, multiple } = useRelationValue(
  () => props.modelValue,
  () => props.settings.multiple === true,
);
/** An empty single select shows the empty option. */
const selected = computed(() => (multiple.value ? ids.value : [ids.value[0] ?? '']));

function toggle(optionValue: string) {
  if (!multiple.value) return emit('update:modelValue', optionValue);
  emit('update:modelValue', toggleInList(ids.value, optionValue));
}
</script>

<template>
  <div v-if="multiple" class="flex flex-wrap gap-2">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="rounded-pill border px-3 py-1 text-sm transition"
      :class="selected.includes(option.value)
        ? 'border-brand-500 bg-brand-50 font-medium text-brand-700 dark:bg-brand-600/20 dark:text-brand-50'
        : 'border-surface-300 text-surface-700 hover:border-surface-400 dark:border-surface-700 dark:text-surface-300 dark:hover:border-surface-600'"
      @click="toggle(option.value)"
    >
      {{ option.label ?? option.value }}
    </button>
  </div>

  <Select
    v-else
    :id="id"
    :model-value="selected[0] ?? ''"
    :disabled="context.readOnly"
    :options="[
      { value: '', label: '-' },
      ...options.map((option) => ({ value: option.value, label: option.label ?? option.value })),
    ]"
    @update:model-value="toggle($event)"
  />
</template>
