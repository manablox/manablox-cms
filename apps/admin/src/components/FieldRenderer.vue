<script setup lang="ts">
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { computed } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import { inputComponent } from '~/lib/field-components';
import { useSlotItems } from '~/lib/plugins/registry';

/** Renders a field's input via its type's `admin.input` key; editor state comes from `FieldContext`. */
const props = defineProps<{
  field: FieldDefinition;
  modelValue: unknown;
  /** Matched against the draft store's error paths. */
  path: (string | number)[];
}>();

const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const context = useFieldContext();

const fieldTypeMeta = computed(() => context.value.fieldTypeMeta(props.field.type));
const component = computed(() => {
  const key = fieldTypeMeta.value?.admin.input ?? props.field.type;
  return inputComponent(key);
});

const error = computed(() => context.value.errorFor(props.path));

/** Containers keep expand controls usable; their nested fields disable themselves. */
const OWN_READ_ONLY = new Set(['block', 'blocks', 'repeater']);
const disabled = computed(
  () =>
    context.value.readOnly &&
    !OWN_READ_ONLY.has(fieldTypeMeta.value?.admin.input ?? props.field.type),
);

/** `admin.width` percent to grid columns; full width on phones. */
const SPAN: Record<number, string> = {
  25: 'sm:col-span-1',
  50: 'sm:col-span-2',
  75: 'sm:col-span-3',
  100: 'sm:col-span-4',
};
const span = computed(() => SPAN[props.field.admin.width] ?? 'sm:col-span-4');

/** What `field.actions` entries get. */
const actionProps = computed(() => ({
  field: props.field,
  value: props.modelValue,
  update: (value: unknown) => emit('update:modelValue', value),
  context: context.value,
}));
const actionEntries = useSlotItems('field.actions');
const hasActions = computed(() =>
  actionEntries.value.some((item) => !item.entry.when || item.entry.when(actionProps.value)),
);
</script>

<template>
  <FormField
    :id="`field-${field.id}`"
    :label="field.label"
    :required="field.required"
    :hint="field.admin.help"
    :error="error"
    class="col-span-4 min-w-0"
    :class="[span, error ? 'mb-invalid' : '']"
    :data-invalid="error ? '' : undefined"
  >
    <template v-if="hasActions" #actions>
      <div class="flex items-center gap-1">
        <PluginSlot id="field.actions" :props="actionProps" />
      </div>
    </template>

    <fieldset v-if="component" :disabled="disabled" class="min-w-0">
      <component
        :is="component"
        :id="`field-${field.id}`"
        :field="field"
        :settings="field.settings"
        :model-value="modelValue"
        :path="path"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </fieldset>
    <p v-else class="mb-hint">
      No editor registered for field type "{{ field.type }}".
    </p>
  </FormField>
</template>
