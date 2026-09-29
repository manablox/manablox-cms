<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../Icon.vue';

/** A list of short strings, such as addresses, as removable chips. */
const model = defineModel<string[]>({ required: true });
defineProps<{
  readOnly: boolean;
  placeholder?: string | undefined;
  label: string;
}>();

const draft = ref('');

function add() {
  const value = draft.value.trim();
  if (!value) return;
  model.value = [...model.value, value];
  draft.value = '';
}

function remove(index: number) {
  model.value = model.value.filter((_, i) => i !== index);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5 rounded-control border border-surface-300 bg-surface-0 px-2 py-1.5 focus-within:border-brand-400 dark:border-surface-700 dark:bg-surface-900">
    <span v-for="(entry, index) in model" :key="`${entry}-${index}`" class="mb-badge-brand gap-1 font-mono">
      {{ entry }}
      <button v-if="!readOnly" type="button" class="-mr-0.5 rounded-pill hover:text-danger-600" :aria-label="`Remove ${entry}`" @click="remove(index)">
        <Icon name="x" class="mb-icon-sm" />
      </button>
    </span>
    <input
      v-if="!readOnly"
      v-model="draft"
      class="min-w-32 flex-1 bg-transparent text-sm outline-none"
      :placeholder="placeholder ?? 'Add one and press Enter'"
      :aria-label="label"
      @keydown.enter.prevent="add"
      @blur="add"
    />
  </div>
</template>
