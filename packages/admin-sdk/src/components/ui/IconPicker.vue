<script setup lang="ts">
import { computed, ref } from 'vue';
import { TYPE_ICON_NAMES } from '../../lib/icon-names';
import Icon from '../Icon.vue';
import Popover from './Popover.vue';
import SearchField from './SearchField.vue';

/** Icon picker; a `Popover`, not a `DropdownMenu`, because the filter input must not close it. */
const model = defineModel<string | null | undefined>({ required: true });
const props = withDefaults(
  defineProps<{
    /** Trigger icon when nothing is chosen. */
    fallback?: string;
    /** Defaults to the content-type set. */
    names?: readonly string[] | undefined;
    disabled?: boolean;
    id?: string | undefined;
  }>(),
  { fallback: 'doc', disabled: false },
);

const open = ref(false);
const search = ref('');

const listed = computed(() => {
  const term = search.value.trim().toLowerCase();
  const names = props.names ?? TYPE_ICON_NAMES;
  return term ? names.filter((name) => name.includes(term)) : names;
});

function choose(name: string | null) {
  model.value = name;
  open.value = false;
  search.value = '';
}
</script>

<template>
  <Popover v-model:open="open" class="w-72">
    <template #trigger>
      <button
        :id="id"
        type="button"
        class="mb-input flex items-center gap-2 text-left"
        :disabled="disabled"
        :aria-label="model ? `Icon: ${model}` : 'Choose an icon'"
      >
        <Icon :name="model || props.fallback" class="mb-icon shrink-0 text-surface-500" />
        <span class="min-w-0 flex-1 truncate font-mono text-xs">
          {{ model || 'Default' }}
        </span>
        <Icon name="down" class="mb-icon-sm shrink-0 text-surface-400" />
      </button>
    </template>

    <SearchField v-model="search" label="Filter icons" size="sm" :debounce="0" class="mb-2" placeholder="Filter..." />

    <div class="grid max-h-64 grid-cols-8 gap-1 overflow-auto">
      <button
        v-for="name in listed"
        :key="name"
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-control transition"
        :class="model === name
          ? 'bg-brand-600 text-white'
          : 'text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'"
        :title="name"
        :aria-label="name"
        :aria-pressed="model === name"
        @click="choose(name)"
      >
        <Icon :name="name" class="mb-icon" />
      </button>
    </div>
    <p v-if="!listed.length" class="mb-hint px-1 py-2">No icon matches.</p>

    <button type="button" class="mb-btn-ghost mb-btn-sm mt-2 w-full" @click="choose(null)">
      No icon
    </button>
  </Popover>
</template>
