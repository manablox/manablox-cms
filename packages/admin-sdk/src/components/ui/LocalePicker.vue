<script setup lang="ts">
import { computed, ref } from 'vue';
import { localeName, localeOptions } from '../../lib/locales';
import Icon from '../Icon.vue';
import Checkbox from './Checkbox.vue';

const model = defineModel<string[]>({ required: true });
/** Searchable multi-select of locale codes, popular languages first. */
const props = defineProps<{
  /** Applied to the search input. */
  id?: string;
}>();

const query = ref('');
const options = computed(() => localeOptions(query.value, model.value));
const selected = computed(() => new Set(model.value));

/** Where the "All languages" divider goes. */
const firstOtherCode = computed(() => options.value.find((option) => !option.popular)?.code);

function toggle(code: string) {
  // `defineModel` only emits on assignment.
  model.value = selected.value.has(code)
    ? model.value.filter((entry) => entry !== code)
    : [...model.value, code];
}
</script>

<template>
  <div>
    <!-- Chips keep the selection visible while the list scrolls. -->
    <ul v-if="model.length" class="mb-2 flex flex-wrap gap-1">
      <li
        v-for="code in model"
        :key="code"
        class="flex items-center gap-1 rounded-control bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800 dark:bg-brand-600/20 dark:text-brand-100"
      >
        <span>{{ localeName(code) }}</span>
        <code class="font-mono text-surface-500">{{ code }}</code>
        <button
          type="button"
          class="text-surface-500 hover:text-danger-600"
          :aria-label="`Remove ${localeName(code)}`"
          @click="toggle(code)"
        >
          <Icon name="x" class="mb-icon-sm" />
        </button>
      </li>
    </ul>

    <div class="overflow-hidden rounded-control border border-surface-300 dark:border-surface-700">
      <input
        :id="props.id"
        v-model="query"
        type="search"
        class="mb-input rounded-none border-0 border-b border-surface-200 focus:ring-0 dark:border-surface-800"
        placeholder="Search languages..."
      />
      <ul class="max-h-48 overflow-y-auto p-1 text-sm">
        <li v-for="option in options" :key="option.code">
          <p
            v-if="option.code === firstOtherCode"
            class="mb-eyebrow px-1.5 pt-2 pb-1 text-surface-500 dark:text-surface-500"
          >
            All languages
          </p>
          <Checkbox
            class="cursor-pointer rounded px-1.5 py-1 hover:bg-surface-100 dark:hover:bg-surface-800"
            :model-value="selected.has(option.code)"
            @update:model-value="toggle(option.code)"
          >
            <span class="flex-1 truncate">{{ option.name }}</span>
            <code class="font-mono mb-meta">{{ option.code }}</code>
          </Checkbox>
        </li>
        <li v-if="!options.length" class="px-1.5 py-2 text-surface-500">No language matches that.</li>
      </ul>
    </div>
  </div>
</template>
