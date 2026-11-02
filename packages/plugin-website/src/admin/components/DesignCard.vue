<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import { type DesignStatus, STATUS_META } from '../model/status';

/** One design in a Design list page: what it is, where it stands, and the way into its designer. */
defineProps<{
  to: string;
  icon: string;
  title: string;
  meta?: string | undefined;
  status: DesignStatus;
  /** The designer button's accessible name. */
  openLabel: string;
}>();
</script>

<template>
  <li class="mb-card ws:flex ws:flex-col ws:gap-3">
    <div class="ws:flex ws:items-start ws:gap-3">
      <span class="mb-tile-sand ws:flex ws:h-9 ws:w-9 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-control">
        <Icon :name="icon" class="mb-icon" />
      </span>
      <div class="ws:min-w-0 ws:flex-1">
        <RouterLink :to="to" class="ws:block ws:truncate ws:font-bold ws:hover:underline">{{ title }}</RouterLink>
        <p v-if="meta" class="ws:truncate mb-meta" :title="meta">{{ meta }}</p>
      </div>
      <span :class="STATUS_META[status].tone" class="ws:shrink-0" :title="STATUS_META[status].hint">{{ STATUS_META[status].label }}</span>
    </div>
    <div v-if="$slots.badges" class="ws:flex ws:flex-wrap ws:gap-1"><slot name="badges" /></div>
    <div class="ws:mt-auto ws:flex ws:items-center ws:gap-1 ws:border-t ws:border-surface-200 ws:pt-3 ws:dark:border-surface-800">
      <RouterLink :to="to" class="mb-btn-outline mb-btn-sm" :aria-label="openLabel">
        <Icon name="palette" class="mb-icon-sm" /> Edit design
      </RouterLink>
      <span class="ws:flex-1" />
      <slot name="actions" />
    </div>
  </li>
</template>
