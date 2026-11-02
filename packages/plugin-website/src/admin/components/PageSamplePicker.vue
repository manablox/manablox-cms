<script setup lang="ts">
import { ContentPicker, Icon, Loader, SegmentedControl } from '@manablox/admin-sdk';
import { ref } from 'vue';

/** Sample content for the page canvas: generated values, or a real document of the type. */
defineProps<{
  typeId: string;
  /** Title of the picked document, once loaded. */
  title: string | null;
}>();
const model = defineModel<string | null>({ required: true });

const source = ref<'generated' | 'document'>(model.value ? 'document' : 'generated');
const SOURCES = [
  { value: 'generated' as const, label: 'Sample text' },
  { value: 'document' as const, label: 'A real page' },
];

function setSource(value: 'generated' | 'document') {
  source.value = value;
  if (value === 'generated') model.value = null;
}
</script>

<template>
  <div class="ws:space-y-2">
    <SegmentedControl :model-value="source" :options="SOURCES" aria-label="Sample content" @update:model-value="setSource" />
    <div v-if="source === 'document'" class="ws:flex ws:flex-wrap ws:items-center ws:gap-2">
      <span v-if="model" class="mb-badge ws:max-w-full ws:truncate"><Icon name="doc" class="mb-icon-sm" /> <template v-if="title">{{ title }}</template><Loader v-else inline :size="12" /></span>
      <span v-else class="mb-meta">No page picked; the sample text stays.</span>
      <ContentPicker :type-ids="[typeId]" :label="model ? 'Change' : 'Pick a page'" trigger-class="mb-btn-outline mb-btn-sm" @pick="model = $event.id" />
    </div>
  </div>
</template>
