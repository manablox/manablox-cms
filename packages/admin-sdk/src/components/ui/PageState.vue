<script setup lang="ts">
import { computed } from 'vue';
import { messageFor } from '../../lib/messages';
import EmptyState from './EmptyState.vue';
import PageLoader from './PageLoader.vue';

/**
 * The states of an editor or detail page: the default slot once `ready`, else a load error
 * with a retry, a not-found state or the page loader. Without `ready`, the slot shows when
 * nothing is loading, failed or missing. One root element, so it can be a routed page's root
 * under the shell's out-in transition.
 */
const props = withDefaults(
  defineProps<{
    ready?: boolean | undefined;
    loading?: boolean;
    error?: unknown;
    notFound?: boolean;
    retry?: (() => unknown) | undefined;
    loadingLabel?: string;
    notFoundTitle?: string;
    notFoundDescription?: string;
    notFoundIcon?: string | undefined;
    /** A way back from the not-found state. */
    backTo?: string | undefined;
    backLabel?: string | undefined;
  }>(),
  {
    ready: undefined,
    loading: false,
    notFound: false,
    loadingLabel: 'Loading...',
    notFoundTitle: 'Not found',
    notFoundDescription: 'It may have been deleted, or it belongs to another space.',
  },
);

const showContent = computed(
  () => props.ready ?? (!props.loading && !props.error && !props.notFound),
);
</script>

<template>
  <div>
    <slot v-if="showContent" />
    <div v-else-if="error" class="mb-page-narrow">
      <div class="mb-callout flex flex-wrap items-center gap-2 rounded-card" role="alert">
        <span class="flex-1">{{ messageFor(error) }}</span>
        <button v-if="retry" type="button" class="mb-btn-ghost mb-btn-sm" @click="retry()">Try again</button>
      </div>
    </div>
    <div v-else-if="notFound" class="mb-page-narrow">
      <EmptyState class="mt-8" :icon="notFoundIcon" :title="notFoundTitle" :description="notFoundDescription">
        <RouterLink v-if="backTo" :to="backTo" class="mb-btn-outline">{{ backLabel ?? 'Back' }}</RouterLink>
      </EmptyState>
    </div>
    <PageLoader v-else :label="loadingLabel" />
  </div>
</template>
