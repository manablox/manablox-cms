<script setup lang="ts">
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import { computed } from 'vue';
import type { Space } from '../queries';
import SpaceImportSection from './SpaceImportSection.vue';

/** Stands in for a space's pages while its import runs or after it failed. */
const props = defineProps<{ space: Space }>();

const failed = computed(() => props.space.importStatus === 'failed');
</script>

<template>
  <div class="space-y-4">
    <EmptyState
      class="mt-8"
      icon="upload"
      :title="failed ? `The import of ${space.name} failed` : `${space.name} is still importing`"
      :description="
        failed
          ? 'Its pages open once the import is resumed and finishes, or pick another space.'
          : 'Its pages open once the import finishes. This page follows its progress.'
      "
    >
      <RouterLink to="/settings?tab=general" class="mb-btn-outline">Space settings</RouterLink>
    </EmptyState>
    <SpaceImportSection :space="space" />
  </div>
</template>
