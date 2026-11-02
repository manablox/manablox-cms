<script setup lang="ts">
import {
  FeatureLock,
  Icon,
  IconButton,
  StatusBadge,
  useFeature,
  usePanel,
  useUiStore,
} from '@manablox/admin-sdk';
import { type DesignStatus, STATUS_META } from '../model/status';

/** A designer's top bar: the way back, what is being designed and its status, then the actions. */
defineProps<{
  title: string;
  /** What kind of design, e.g. "Block design". */
  kind: string;
  icon: string;
  back: { to: string; label: string };
  status?: DesignStatus | undefined;
  readOnly?: boolean;
}>();

const ui = useUiStore();
/** Designing locked: the lock says why everything is read-only. */
const designing = useFeature('plugins.website.design');
/** Folding the main menu gives the canvas room. */
const sidebar = usePanel('sidebar');
</script>

<template>
  <header class="ws:flex ws:flex-wrap ws:items-center ws:gap-x-3 ws:gap-y-2 ws:border-b ws:border-surface-200 ws:bg-surface-0 ws:px-3 ws:py-2 ws:dark:border-surface-800 ws:dark:bg-surface-900">
    <RouterLink :to="back.to" class="mb-btn-ghost mb-btn-sm ws:shrink-0" :aria-label="`Back to ${back.label}`" :title="`Back to ${back.label}`">
      <Icon name="arrow-left" class="mb-icon-sm" /> <span class="ws:hidden ws:sm:inline">{{ back.label }}</span>
    </RouterLink>
    <IconButton
      v-if="ui.isWide"
      :icon="sidebar.collapsed.value ? 'shrink' : 'expand'"
      :label="sidebar.collapsed.value ? 'Show the main menu' : 'Hide the main menu for more room'"
      class="ws:shrink-0"
      :aria-pressed="sidebar.collapsed.value"
      @click="sidebar.toggle()"
    />
    <span class="ws:hidden ws:h-6 ws:w-px ws:bg-surface-200 ws:sm:block ws:dark:bg-surface-800" aria-hidden="true" />
    <!-- A small basis, so a long title truncates instead of pushing the actions onto their own line. -->
    <div class="ws:flex ws:min-w-0 ws:flex-[1_1_12rem] ws:items-center ws:gap-2.5">
      <span class="mb-tile-clay ws:flex ws:h-8 ws:w-8 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-control">
        <Icon :name="icon" class="mb-icon" />
      </span>
      <div class="ws:min-w-0">
        <p class="ws:text-2xs ws:leading-tight ws:text-surface-500">{{ kind }}</p>
        <h1 class="ws:flex ws:min-w-0 ws:items-center ws:gap-2 ws:font-display ws:text-base ws:leading-tight ws:font-bold ws:text-surface-950 ws:dark:text-surface-50">
          <span class="ws:truncate" :title="title">{{ title }}</span>
          <span v-if="status" :class="STATUS_META[status].tone" class="ws:shrink-0" :title="STATUS_META[status].hint">{{ STATUS_META[status].label }}</span>
          <StatusBadge v-if="readOnly" status="read-only" class="ws:shrink-0" />
          <FeatureLock v-if="designing.locked" feature="plugins.website.design" label="Designing is locked" class="ws:shrink-0" />
        </h1>
      </div>
    </div>
    <div v-if="$slots.default" class="ws:flex ws:flex-wrap ws:items-center ws:gap-1.5">
      <slot />
    </div>
  </header>
</template>
