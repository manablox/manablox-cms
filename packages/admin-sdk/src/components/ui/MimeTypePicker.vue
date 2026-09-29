<script setup lang="ts">
import { withinInstance } from '@manablox/core';
import { computed, ref } from 'vue';
import { customMimeType, mimeTypeLabel, mimeTypeOptions } from '../../lib/mime-types';
import Icon from '../Icon.vue';
import Checkbox from './Checkbox.vue';

const model = defineModel<string[]>({ required: true });
/** Searchable multi-select of MIME types: families first, then exact types, plus custom entries. */
const props = defineProps<{
  id?: string;
  /** Allowed entries; empty means no restriction. */
  within?: readonly string[];
}>();

const query = ref('');
const options = computed(() => mimeTypeOptions(query.value, model.value));
const selected = computed(() => new Set(model.value));
const custom = computed(() => customMimeType(query.value));

/** Where the "Exact types" divider goes. */
const firstExact = computed(() => options.value.find((option) => !option.isFamily)?.value);

const offered = (value: string) => withinInstance(value, props.within ?? []);

function toggle(value: string) {
  // `defineModel` only emits on assignment.
  model.value = selected.value.has(value)
    ? model.value.filter((entry) => entry !== value)
    : [...model.value, value];
}

function addCustom() {
  if (!custom.value || !offered(custom.value)) return;
  toggle(custom.value);
  query.value = '';
}
</script>

<template>
  <div class="min-w-0">
    <ul v-if="model.length" class="mb-2 flex flex-wrap gap-1">
      <!-- Label only; the exact type is in the title. -->
      <li
        v-for="value in model"
        :key="value"
        class="flex max-w-full items-center gap-1 rounded-control bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800 dark:bg-brand-600/20 dark:text-brand-100"
        :title="value"
      >
        <span class="min-w-0 truncate">{{ mimeTypeLabel(value) }}</span>
        <button
          type="button"
          class="text-surface-500 hover:text-danger-600"
          :aria-label="`Remove ${mimeTypeLabel(value)}`"
          @click="toggle(value)"
        >
          <Icon name="x" class="mb-icon-sm" />
        </button>
      </li>
    </ul>

    <div class="min-w-0 overflow-hidden rounded-control border border-surface-300 dark:border-surface-700">
      <input
        :id="props.id"
        v-model="query"
        type="search"
        class="mb-input rounded-none border-0 border-b border-surface-200 focus:ring-0 dark:border-surface-800"
        placeholder="Search by name, type or extension..."
        @keydown.enter.prevent="addCustom"
      />
      <ul class="max-h-48 overflow-y-auto p-1 text-sm">
        <li v-for="option in options" :key="option.value">
          <p
            v-if="option.value === firstExact"
            class="mb-eyebrow px-1.5 pt-2 pb-1 text-surface-500 dark:text-surface-500"
          >
            Exact types
          </p>
          <Checkbox
            class="rounded px-1.5 py-1"
            :class="offered(option.value) ? 'cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-800' : 'cursor-not-allowed opacity-50'"
            :title="offered(option.value) ? undefined : 'The instance does not allow this type'"
            :model-value="selected.has(option.value)"
            :disabled="!offered(option.value)"
            @update:model-value="toggle(option.value)"
          >
            <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
            <code v-if="option.ext" class="shrink-0 font-mono text-xs text-surface-400">{{ option.ext }}</code>
            <code class="min-w-0 max-w-40 shrink truncate font-mono mb-meta" :title="option.value">{{ option.value }}</code>
          </Checkbox>
        </li>
        <li v-if="custom" class="px-1.5 py-1">
          <button
            type="button"
            class="mb-btn-ghost mb-btn-sm w-full justify-start"
            :disabled="!offered(custom)"
            @click="addCustom"
          >
            <Icon name="plus" class="mb-icon-sm" /> Add <code class="font-mono">{{ custom }}</code>
          </button>
        </li>
        <li v-else-if="!options.length" class="px-1.5 py-2 text-surface-500">
          No type matches that. Type a full one such as <code class="font-mono">image/x-foo</code> to add it.
        </li>
      </ul>
    </div>
  </div>
</template>
