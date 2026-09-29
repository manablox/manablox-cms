<script setup lang="ts">
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';

/** List on the left, selected item (or an empty state) on the right. */
withDefaults(
  defineProps<{
    hasSelection: boolean;
    emptyTitle?: string;
    emptyDescription?: string | undefined;
    emptyIcon?: string | undefined;
  }>(),
  { emptyTitle: 'Nothing chosen' },
);
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
    <aside class="space-y-3">
      <slot name="filter" />
      <nav class="mb-card p-2" :aria-label="$attrs['aria-label'] as string | undefined">
        <slot name="list" />
      </nav>
      <slot name="actions" />
    </aside>

    <slot v-if="hasSelection" />
    <EmptyState
      v-else
      class="self-start"
      :icon="emptyIcon"
      :title="emptyTitle"
      :description="emptyDescription"
    />
  </div>
</template>
