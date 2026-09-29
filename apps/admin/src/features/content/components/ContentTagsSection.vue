<script setup lang="ts">
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import { useFeature } from '@manablox/admin-sdk/lib/space';
import TagInput from '~/components/TagInput.vue';
import { useDraftStore } from '../useDraftStore';

/** The open document's tags, shared by every translation. */
defineProps<{ canWrite: boolean }>();

const draft = useDraftStore();
const tagsFeature = useFeature('tags');
</script>

<template>
  <div v-if="draft.doc && !tagsFeature.hidden" class="mb-card space-y-2">
    <div class="flex items-center gap-1">
      <h2 class="flex-1 text-sm font-bold">Tags</h2>
      <FeatureLock v-if="tagsFeature.locked" feature="tags" :state="tagsFeature" align="end" />
    </div>
    <TagInput v-if="canWrite && tagsFeature.enabled" v-model="draft.doc.tags" />
    <ul v-else-if="draft.doc.tags.length" class="flex flex-wrap gap-1">
      <li v-for="tag in draft.doc.tags" :key="tag" class="mb-badge">{{ tag }}</li>
    </ul>
    <p v-else class="mb-meta">No tags yet.</p>
    <p class="mb-hint">Shared by every translation. Tags also match when searching.</p>
  </div>
</template>
