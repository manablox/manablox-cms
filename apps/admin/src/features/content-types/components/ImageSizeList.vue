<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Select, { type SelectOption } from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { technicalName } from '@manablox/core';
import { computed } from 'vue';

/** Per-field image renditions by measurement; `name` is the delivery key. */
interface ImageSize {
  name: string;
  width?: number;
  height?: number;
  fit: 'cover' | 'contain' | 'inside' | 'outside' | 'fill';
  format: 'avif' | 'webp' | 'jpeg' | 'png';
}

const props = defineProps<{ modelValue: unknown; readOnly: boolean; id: string }>();
const emit = defineEmits<{ 'update:modelValue': [ImageSize[]] }>();

const FITS: SelectOption<ImageSize['fit']>[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'inside', label: 'Inside' },
  { value: 'outside', label: 'Outside' },
  { value: 'fill', label: 'Fill' },
];
const FORMATS = (['webp', 'avif', 'jpeg', 'png'] as const).map((value) => ({
  value,
  label: value,
}));

const sizes = computed<ImageSize[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as Partial<ImageSize>[]).map((entry) => ({
        name: typeof entry.name === 'string' ? entry.name : '',
        ...(typeof entry.width === 'number' ? { width: entry.width } : {}),
        ...(typeof entry.height === 'number' ? { height: entry.height } : {}),
        fit: entry.fit ?? 'cover',
        format: entry.format ?? 'webp',
      }))
    : [],
);

function write(index: number, patch: Partial<ImageSize>) {
  emit(
    'update:modelValue',
    sizes.value.map((size, at) => (at === index ? { ...size, ...patch } : size)),
  );
}

/** An empty dimension is omitted (keeps the aspect ratio), not zero. */
function setDimension(index: number, key: 'width' | 'height', raw: string) {
  const next = { ...sizes.value[index] } as ImageSize;
  if (raw === '') delete next[key];
  else next[key] = Number(raw);
  emit(
    'update:modelValue',
    sizes.value.map((size, at) => (at === index ? next : size)),
  );
}

function add() {
  emit('update:modelValue', [
    ...sizes.value,
    { name: '', width: 800, fit: 'cover', format: 'webp' },
  ]);
}

function removeAt(index: number) {
  emit(
    'update:modelValue',
    sizes.value.filter((_, at) => at !== index),
  );
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="(size, index) in sizes"
      :key="index"
      class="grid items-end gap-2 sm:grid-cols-[1fr_5rem_5rem_1fr_1fr_auto]"
    >
      <TextField
        :id="`${id}-${index}-name`"
        label="Name"
        :model-value="size.name"
        :disabled="readOnly"
        class="mb-input-mono"
        placeholder="hero"
        @update:model-value="write(index, { name: technicalName(String($event ?? '')) })"
      />
      <TextField
        :id="`${id}-${index}-w`"
        label="Width"
        :model-value="size.width ?? ''"
        :disabled="readOnly"
        placeholder="auto"
        @update:model-value="setDimension(index, 'width', String($event ?? ''))"
      />
      <TextField
        :id="`${id}-${index}-h`"
        label="Height"
        :model-value="size.height ?? ''"
        :disabled="readOnly"
        placeholder="auto"
        @update:model-value="setDimension(index, 'height', String($event ?? ''))"
      />
      <FormField :id="`${id}-${index}-fit`" label="Fit">
        <Select
          :id="`${id}-${index}-fit`"
          :model-value="size.fit"
          :options="FITS"
          :disabled="readOnly"
          @update:model-value="write(index, { fit: $event })"
        />
      </FormField>
      <FormField :id="`${id}-${index}-format`" label="Format">
        <Select
          :id="`${id}-${index}-format`"
          :model-value="size.format"
          :options="FORMATS"
          :disabled="readOnly"
          @update:model-value="write(index, { format: $event })"
        />
      </FormField>
      <IconButton
        icon="trash"
        :label="`Remove the ${size.name || 'unnamed'} size`"
        danger
        size="md"
        :disabled="readOnly"
        @click="removeAt(index)"
      />
    </div>

    <button type="button" class="mb-btn-outline mb-btn-sm" :disabled="readOnly" @click="add">
      <Icon name="plus" class="mb-icon-sm" /> Add a size
    </button>
    <p class="mb-hint">
      One dimension may be left empty to keep the aspect ratio. Two fields asking for the
      same measurements share the rendered file.
    </p>
  </div>
</template>
