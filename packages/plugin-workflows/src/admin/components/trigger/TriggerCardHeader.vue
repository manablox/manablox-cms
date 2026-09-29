<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';

/** A trigger card's head: tile, eyebrow and title, then its controls. */
defineProps<{
  icon: string;
  /** The tile's colour classes. */
  tile: string;
  eyebrow: string;
  title: string;
}>();
</script>

<template>
  <div class="wf:flex wf:flex-wrap wf:items-center wf:gap-3 wf:border-b wf:border-surface-200 wf:px-4 wf:py-3 wf:dark:border-surface-800">
    <span class="wf:flex wf:h-9 wf:w-9 wf:shrink-0 wf:items-center wf:justify-center wf:rounded-card" :class="tile">
      <Icon :name="icon" class="mb-icon" />
    </span>
    <div class="wf:min-w-0 wf:flex-1">
      <p class="mb-eyebrow wf:text-2xs">{{ eyebrow }}</p>
      <h2 class="wf:truncate wf:text-sm wf:font-bold">{{ title }}</h2>
    </div>
    <slot />
  </div>
</template>
