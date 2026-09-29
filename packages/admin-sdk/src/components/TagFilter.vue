<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTags } from '../features/tags/queries';
import { plural } from '../lib/format';
import Icon from './Icon.vue';
import Checkbox from './ui/Checkbox.vue';
import Popover from './ui/Popover.vue';

/** Narrows a listing to documents or assets carrying any of the chosen tags. */
const model = defineModel<string[]>({ required: true });

const open = ref(false);
const query = ref('');

const { data: tags } = useTags();

const chosen = computed(() => new Set(model.value));

const matching = computed(() => {
  const term = query.value.trim().toLowerCase();
  return (tags.value ?? []).filter((tag) => !term || tag.name.toLowerCase().includes(term));
});

const label = computed(() =>
  model.value.length === 0 ? 'Tags' : plural(model.value.length, 'tag'),
);

function toggle(id: string) {
  model.value = chosen.value.has(id)
    ? model.value.filter((entry) => entry !== id)
    : [...model.value, id];
}
</script>

<template>
  <Popover v-model:open="open" class="w-64 p-1">
    <template #trigger>
      <button
        type="button"
        class="mb-btn-ghost mb-btn-sm"
        :class="model.length ? 'text-brand-700 dark:text-brand-200' : ''"
      >
        <Icon name="tag" class="mb-icon-sm" />
        {{ label }}
        <Icon name="chevron" class="mb-icon-sm" />
      </button>
    </template>

    <input
      v-model="query"
      type="search"
      class="mb-input mb-input-sm mb-2"
      placeholder="Search tags..."
      autocomplete="off"
    />
    <p v-if="!matching.length" class="px-2 py-2 text-sm text-surface-500">
      {{ tags?.length ? 'No tag matches that.' : 'This space has no tags yet.' }}
    </p>
    <ul v-else class="max-h-64 overflow-y-auto">
      <li v-for="tag in matching" :key="tag.id">
        <Checkbox
          class="cursor-pointer rounded-control px-2 py-1 hover:bg-surface-100 dark:hover:bg-surface-800"
          :model-value="chosen.has(tag.id)"
          @update:model-value="toggle(tag.id)"
        >
          <span class="min-w-0 truncate">{{ tag.name }}</span>
        </Checkbox>
      </li>
    </ul>
    <button
      v-if="model.length"
      type="button"
      class="mb-btn-ghost mb-btn-sm mt-1 w-full justify-start"
      @click="model = []"
    >
      <Icon name="x" class="mb-icon-sm" /> Clear
    </button>
  </Popover>
</template>
