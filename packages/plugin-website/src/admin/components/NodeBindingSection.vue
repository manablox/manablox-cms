<script setup lang="ts">
import { FormField, NumberField, Select, Switch, TextField } from '@manablox/admin-sdk';
import { type BindingFormat, type DesignNode, ELEMENTS } from '@manablox/site';
import { computed } from 'vue';
import {
  bindable,
  bindingOptions,
  defaultFormat,
  fieldAtPath,
  formatKinds,
} from '../model/bindings';
import { useDesignerContext } from '../useDesignerContext';
import LocalizedTextField from './LocalizedTextField.vue';

/** The field a node shows, and how its value is formatted. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const { fields, repeats, locales, locale, readOnly } = useDesignerContext();
const el = computed(() => props.node.el);
const info = computed(() => ELEMENTS[el.value]);

function update(next: DesignNode, group?: string) {
  if (!readOnly.value) emit('update', next, group);
}

// Binding.
const options = computed(() => bindingOptions(fields.value, el.value, repeats.value));
const bindingChoices = computed(() => {
  const list = options.value.map((option) => ({
    value: option.value,
    label: option.label,
    hint: option.hint,
  }));
  const current = props.node.bind?.field;
  if (current && !list.some((option) => option.value === current))
    list.unshift({ value: current, label: `${current} (not available here)`, hint: 'broken' });
  return info.value.requiresBind
    ? list
    : [{ value: '', label: 'Nothing, use the text below', hint: 'static' }, ...list];
});

function setBinding(path: string) {
  const next: DesignNode = { ...props.node };
  const target = path ? fieldAtPath(fields.value, path) : null;
  if (!path) delete next.bind;
  else {
    const format = target ? defaultFormat(target.field, target.item) : undefined;
    next.bind = format ? { field: path, format } : { field: path };
  }
  update(next);
}

// Format.
const bound = computed(() =>
  props.node.bind?.field ? fieldAtPath(fields.value, props.node.bind.field) : null,
);
const kinds = computed(() =>
  bound.value && !['repeat', 'image', 'video', 'blocks', 'block', 'template'].includes(el.value)
    ? formatKinds(bound.value.field, bound.value.item)
    : [],
);
const format = computed(() => props.node.bind?.format);
const FORMAT_LABELS: Record<BindingFormat['type'], string> = {
  date: 'Date',
  number: 'Number',
  boolean: 'Yes or no',
  list: 'List',
  excerpt: 'Shortened text',
};
const formatChoices = computed(() => [
  { value: '', label: 'As stored' },
  ...kinds.value.map((kind) => ({ value: kind, label: FORMAT_LABELS[kind] })),
]);

function setFormat(next: BindingFormat | undefined) {
  if (!props.node.bind) return;
  const bind = { ...props.node.bind };
  if (next) bind.format = next;
  else delete bind.format;
  update({ ...props.node, bind }, `format:${props.node.id}`);
}

function pickFormat(kind: string) {
  if (!kind) setFormat(undefined);
  else if (kind === 'excerpt') setFormat({ type: 'excerpt', length: 160 });
  else setFormat({ type: kind } as BindingFormat);
}

function patchFormat(patch: Record<string, unknown>) {
  const current = format.value;
  if (!current) return;
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const [key, value] of Object.entries(next))
    if (value === undefined || value === '' || value === null) delete next[key];
  setFormat(next as BindingFormat);
}
</script>

<template>
  <FormField v-if="bindable(el)" label="Shows" :hint="options.length ? undefined : 'No field fits this element here.'">
    <template #default="{ id }">
      <Select
        :id="id"
        :model-value="node.bind?.field ?? ''"
        :options="bindingChoices"
        :disabled="readOnly"
        @update:model-value="setBinding($event)"
      />
    </template>
  </FormField>

  <div v-if="kinds.length" class="ws:space-y-3 ws:rounded-control ws:border ws:border-surface-200 ws:p-3 ws:dark:border-surface-700">
    <FormField label="Format">
      <template #default="{ id }">
        <Select :id="id" :model-value="format?.type ?? ''" :options="formatChoices" :disabled="readOnly" @update:model-value="pickFormat($event)" />
      </template>
    </FormField>
    <template v-if="format?.type === 'date'">
      <FormField label="Date style">
        <template #default="{ id }">
          <Select
            :id="id"
            :model-value="format.style ?? 'medium'"
            :options="[{ value: 'short', label: 'Short (3/14/26)' }, { value: 'medium', label: 'Medium (Mar 14, 2026)' }, { value: 'long', label: 'Long (March 14, 2026)' }]"
            :disabled="readOnly"
            @update:model-value="patchFormat({ style: $event })"
          />
        </template>
      </FormField>
      <Switch :model-value="format.time === true" :disabled="readOnly" @update:model-value="patchFormat({ time: $event || undefined })">
        <span class="ws:text-sm">Show the time</span>
      </Switch>
    </template>
    <template v-else-if="format?.type === 'number'">
      <FormField label="Style">
        <template #default="{ id }">
          <Select
            :id="id"
            :model-value="format.style ?? 'decimal'"
            :options="[{ value: 'decimal', label: 'Number' }, { value: 'percent', label: 'Percent' }, { value: 'currency', label: 'Currency' }]"
            :disabled="readOnly"
            @update:model-value="patchFormat({ style: $event === 'decimal' ? undefined : $event, currency: $event === 'currency' ? (format.currency ?? 'EUR') : undefined })"
          />
        </template>
      </FormField>
      <TextField v-if="format.style === 'currency'" :model-value="format.currency ?? ''" label="Currency code" hint="Three letters, e.g. EUR or USD." :disabled="readOnly" @update:model-value="patchFormat({ currency: String($event ?? '').toUpperCase().slice(0, 3) || undefined })" />
      <NumberField :model-value="format.decimals" label="Decimals" :min="0" :max="10" nullable :disabled="readOnly" @update:model-value="patchFormat({ decimals: $event ?? undefined })" />
      <Switch :model-value="format.grouping !== false" :disabled="readOnly" @update:model-value="patchFormat({ grouping: $event ? undefined : false })">
        <span class="ws:text-sm">Thousands separator</span>
      </Switch>
    </template>
    <template v-else-if="format?.type === 'boolean'">
      <LocalizedTextField :model-value="format.trueText" label="Text for yes" :locales="locales" :locale="locale" :read-only="readOnly" @update:model-value="patchFormat({ trueText: $event })" />
      <LocalizedTextField :model-value="format.falseText" label="Text for no" :locales="locales" :locale="locale" :read-only="readOnly" @update:model-value="patchFormat({ falseText: $event })" />
    </template>
    <TextField v-else-if="format?.type === 'list'" :model-value="format.separator ?? ''" label="Separator" hint="Between entries; a comma by default." :disabled="readOnly" @update:model-value="patchFormat({ separator: String($event ?? '').slice(0, 10) || undefined })" />
    <NumberField v-else-if="format?.type === 'excerpt'" :model-value="format.length" label="At most this many characters" :min="1" :max="5000" nullable :disabled="readOnly" @update:model-value="patchFormat({ length: $event ?? undefined })" />
  </div>
</template>
