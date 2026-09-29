<script setup lang="ts">
import Icon from '../Icon.vue';
import TextField from './TextField.vue';

type Entry = { name: string; value: string };

/** Name/value pairs such as headers. Values are templates, so wider and monospaced. */
const model = defineModel<Entry[]>({ required: true });
defineProps<{
  readOnly: boolean;
  label: string;
  namePlaceholder?: string | undefined;
  valuePlaceholder?: string | undefined;
}>();

function patch(index: number, part: Partial<Entry>) {
  model.value = model.value.map((entry, i) => (i === index ? { ...entry, ...part } : entry));
}
</script>

<template>
  <div class="space-y-1.5">
    <div v-for="(entry, index) in model" :key="index" class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] gap-1.5">
      <TextField
        :model-value="entry.name"
        class="mb-input-mono"
        :placeholder="namePlaceholder ?? 'name'"
        :readonly="readOnly"
        :aria-label="`${label} ${index + 1}: name`"
        @update:model-value="patch(index, { name: String($event ?? '') })"
      />
      <TextField
        :model-value="entry.value"
        class="mb-input-mono"
        :placeholder="valuePlaceholder ?? 'value'"
        :readonly="readOnly"
        :aria-label="`${label} ${index + 1}: value`"
        @update:model-value="patch(index, { value: String($event ?? '') })"
      />
      <button
        v-if="!readOnly"
        type="button"
        class="mb-btn-ghost mb-btn-icon"
        :aria-label="`Remove ${label} ${index + 1}`"
        @click="model = model.filter((_, i) => i !== index)"
      >
        <Icon name="x" />
      </button>
    </div>
    <button
      v-if="!readOnly"
      type="button"
      class="mb-btn-ghost mb-btn-sm"
      @click="model = [...model, { name: '', value: '' }]"
    >
      <Icon name="plus" class="mb-icon-sm" /> Add
    </button>
  </div>
</template>
