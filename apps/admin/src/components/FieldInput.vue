<script setup lang="ts">
import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { computed } from 'vue';
import { inputComponent } from '~/lib/field-components';

/** A field type's bare input, without label or `field.actions`; editor state comes from `FieldContext`. */
const props = defineProps<{
  field: FieldDefinition;
  modelValue: unknown;
  path: (string | number)[];
}>();
const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const context = useFieldContext();
const component = computed(() =>
  inputComponent(context.value.fieldTypeMeta(props.field.type)?.admin.input ?? props.field.type),
);
</script>

<template>
  <component
    :is="component"
    v-if="component"
    :id="`field-${field.id}`"
    :field="field"
    :settings="field.settings"
    :model-value="modelValue"
    :path="path"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
