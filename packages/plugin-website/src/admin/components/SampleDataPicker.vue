<script setup lang="ts">
import { FormField, SearchField, SegmentedControl, Select } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { SampleChoice } from '../model/sample-data';
import { useBlockUsage } from '../queries';

/**
 * Sample data for the block canvas: generated values, or a block from a real document that
 * uses the type (picked by document, then by block when it holds several).
 */
const props = defineProps<{
  blockTypeId: string;
  /** Document types that can hold this block. */
  typeIds: readonly string[];
  locale: string;
}>();
const model = defineModel<SampleChoice | null>({ required: true });

const source = ref<'generated' | 'document'>(model.value ? 'document' : 'generated');
const SOURCES = [
  { value: 'generated' as const, label: 'Sample text' },
  { value: 'document' as const, label: 'A real page' },
];
const term = ref('');
const usage = useBlockUsage(
  () => props.blockTypeId,
  () => props.typeIds,
  () => props.locale,
  term,
  () => source.value === 'document',
);

function setSource(value: 'generated' | 'document') {
  source.value = value;
  if (value === 'generated') model.value = null;
}

const documents = computed(() => usage.data.value ?? []);
const picked = computed(() =>
  model.value ? documents.value.find((entry) => entry.id === model.value?.documentId) : null,
);
const blockChoices = computed(() =>
  (picked.value?.blocks ?? []).map((block, index) => ({
    value: block.blockId,
    label: `Block ${index + 1} of ${picked.value?.blocks.length}`,
  })),
);

function pick(documentId: string, blockId?: string) {
  const entry = documents.value.find((doc) => doc.id === documentId);
  const block = entry?.blocks.find((item) => item.blockId === blockId) ?? entry?.blocks[0];
  if (entry && block) model.value = { documentId: entry.id, title: entry.title, block };
}
</script>

<template>
  <div class="ws:space-y-2">
    <SegmentedControl :model-value="source" :options="SOURCES" aria-label="Sample data" @update:model-value="setSource" />
    <template v-if="source === 'document'">
      <p v-if="typeIds.length === 0" class="mb-meta">No content type has a blocks field, so no page can hold this block yet.</p>
      <template v-else>
        <SearchField v-model="term" label="Find a page" size="sm" />
        <p v-if="usage.isPending.value" class="mb-meta">Looking for pages with this block...</p>
        <p v-else-if="usage.error.value" class="ws:text-xs ws:text-danger-600">Could not load the pages.</p>
        <p v-else-if="documents.length === 0" class="mb-meta">
          {{ term.trim() ? 'No matching page uses this block.' : 'No recent page uses this block yet; the sample text stays.' }}
        </p>
        <ul v-else class="ws:max-h-48 ws:space-y-px ws:overflow-y-auto">
          <li v-for="doc in documents" :key="doc.id">
            <button
              type="button"
              class="mb-list-item mb-list-item-sm ws:w-full ws:text-left"
              :class="model?.documentId === doc.id ? 'mb-list-item-active' : ''"
              :aria-pressed="model?.documentId === doc.id"
              @click="pick(doc.id)"
            >
              <span class="ws:min-w-0 ws:flex-1 ws:truncate">{{ doc.title || 'Untitled' }}</span>
              <span class="ws:text-2xs ws:text-surface-500">{{ doc.blocks.length }}x</span>
            </button>
          </li>
        </ul>
        <FormField v-if="blockChoices.length > 1" label="Which block">
          <template #default="{ id }">
            <Select
              :id="id"
              :model-value="model?.block.blockId ?? ''"
              :options="blockChoices"
              variant="sm"
              @update:model-value="model && pick(model.documentId, $event)"
            />
          </template>
        </FormField>
      </template>
    </template>
  </div>
</template>
