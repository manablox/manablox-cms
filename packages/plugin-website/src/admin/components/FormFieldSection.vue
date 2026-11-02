<script setup lang="ts">
import { FormField, Icon, Select, useFeature, useSpaceStore } from '@manablox/admin-sdk';
import type { DesignNode } from '@manablox/site';
import { computed } from 'vue';
import { boundFieldOf, enclosingForm, fillable, placedFieldIds } from '../model/form-design';
import { useDesignerContext } from '../useDesignerContext';

/** Which field a form input fills, how it asks for it, and hiding it. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const spaces = useSpaceStore();
const designer = useDesignerContext();
/** Setting up forms can be locked apart from designing; then the input is read-only. */
const formsConfig = useFeature('plugins.website.forms.config');
const readOnly = computed(() => designer.readOnly.value || !formsConfig.value.enabled);

const form = computed(() => {
  const root = designer.root.value;
  return root ? enclosingForm(root, props.node.id) : null;
});
/** In a form bound to a field the input repeats for every field of the picked type. */
const bound = computed(() => Boolean(form.value && boundFieldOf(form.value)));
const type = computed(
  () => spaces.dataKinds.find((entry) => entry.id === form.value?.props?.databagTypeId) ?? null,
);
const fieldId = computed(() =>
  typeof props.node.props?.fieldId === 'string' ? props.node.props.fieldId : '',
);
const field = computed(
  () => type.value?.fields.find((entry) => entry.id === fieldId.value) ?? null,
);

const fieldOptions = computed(() => {
  const used = form.value ? placedFieldIds(form.value) : new Set<string>();
  const list = (type.value?.fields ?? [])
    .filter((entry) => entry.id === fieldId.value || (fillable(entry) && !used.has(entry.id)))
    .map((entry) => ({ value: entry.id, label: entry.label || entry.name, hint: entry.type }));
  if (fieldId.value && !field.value)
    list.unshift({ value: fieldId.value, label: 'A deleted field', hint: 'broken' });
  return list;
});

/** Strings can be asked for in a line, a box or as an e-mail address. */
const INPUTS = [
  { value: 'text', label: 'One line' },
  { value: 'textarea', label: 'Several lines' },
  { value: 'email', label: 'E-mail address' },
];
const inputChoice = computed(() => field.value?.type === 'string');

function setProp(key: string, value: unknown) {
  if (readOnly.value) return;
  const next = { ...props.node.props };
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  emit('update', { ...props.node, props: next }, `props:${props.node.id}:${key}`);
}

function pickField(id: string) {
  const target = type.value?.fields.find((entry) => entry.id === id);
  if (!target) return;
  const next: Record<string, unknown> = { ...props.node.props, fieldId: id };
  // The input kind follows the field unless it is picked for a string.
  delete next.input;
  emit('update', { ...props.node, props: next });
}

const required = computed(() => field.value?.required === true);
</script>

<template>
  <div class="ws:space-y-4">
    <p v-if="!form" class="mb-callout ws:text-xs">This input is not inside a form, so it shows nothing.</p>
    <p v-else-if="bound" class="mb-hint">
      Repeats for every field of the databag type an editor picks, labelled with the field's label. Style it here once for all of them.
    </p>
    <FormField v-else label="Fills the field">
      <template #default="{ id }">
        <Select :id="id" :model-value="fieldId" :options="fieldOptions" :disabled="readOnly" @update:model-value="pickField" />
      </template>
    </FormField>
    <FormField v-if="inputChoice" label="Asks for it as">
      <template #default="{ id }">
        <Select
          :id="id"
          :model-value="typeof node.props?.input === 'string' ? node.props.input : 'text'"
          :options="INPUTS"
          :disabled="readOnly"
          @update:model-value="setProp('input', $event)"
        />
      </template>
    </FormField>
    <p v-if="field && required" class="mb-hint">Required: visitors must fill it, and the input cannot be hidden.</p>
    <button
      v-else-if="!readOnly && !bound"
      type="button"
      class="mb-btn-outline mb-btn-sm"
      title="Removes the input; the field stays empty in new entries"
      @click="designer.remove(node.id)"
    >
      <Icon name="eye" class="mb-icon-sm" /> Hide this input
    </button>
  </div>
</template>
