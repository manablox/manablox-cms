<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';
import { useLocalStorage } from '@vueuse/core';
import { useId } from 'vue';

/** A collapsible section of a designer pane; `id` keeps it open or closed across visits. */
const props = withDefaults(
  defineProps<{
    id: string;
    title: string;
    icon?: string | undefined;
    /** Short text after the title, e.g. a count. */
    summary?: string | undefined;
    summaryTone?: 'muted' | 'warn' | 'ok';
    defaultOpen?: boolean;
  }>(),
  { summaryTone: 'muted', defaultOpen: true },
);

const open = useLocalStorage(`manablox.design.section.${props.id}`, props.defaultOpen);
const bodyId = useId();

const TONES = {
  muted: 'ws:text-surface-500',
  warn: 'mb-badge-warn',
  ok: 'mb-badge-ok',
};
</script>

<template>
  <section class="ws:-mx-3 ws:border-t ws:border-surface-200 ws:px-3 ws:pt-2 ws:first:border-t-0 ws:first:pt-0 ws:dark:border-surface-800">
    <button
      type="button"
      class="ws:flex ws:w-full ws:items-center ws:gap-2 ws:rounded-control ws:py-1 ws:text-left"
      :aria-expanded="open"
      :aria-controls="bodyId"
      @click="open = !open"
    >
      <Icon v-if="icon" :name="icon" class="mb-icon-sm ws:shrink-0 ws:text-surface-500" />
      <span class="ws:min-w-0 ws:flex-1 ws:truncate ws:text-sm ws:font-semibold">{{ title }}</span>
      <span v-if="summary" class="ws:shrink-0 ws:text-2xs" :class="TONES[summaryTone]">{{ summary }}</span>
      <Icon name="down" class="mb-icon-sm ws:shrink-0 ws:text-surface-400 ws:transition-transform" :class="open ? '' : 'ws:-rotate-90'" />
    </button>
    <div v-show="open" :id="bodyId" class="ws:space-y-2 ws:pt-1 ws:pb-1">
      <slot />
    </div>
  </section>
</template>
