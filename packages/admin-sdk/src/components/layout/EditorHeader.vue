<script setup lang="ts">
import Icon from '../Icon.vue';

/** Editor page header: eyebrow, title, badges and actions; `sticky` pins it on scroll. */
withDefaults(
  defineProps<{
    title: string;
    eyebrow?: string | undefined;
    eyebrowIcon?: string | undefined;
    sticky?: boolean;
  }>(),
  { sticky: false },
);
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-2"
    :class="sticky
      ? 'mb-surface-sticky mb-z-sticky sticky top-0 border-b border-surface-200 px-4 py-3 sm:px-6 dark:border-surface-800'
      : 'mb-6 items-end'"
  >
    <!-- A small basis, so a long title truncates instead of pushing the actions onto their own line. -->
    <div class="min-w-0 flex-[1_1_12rem]">
      <p v-if="eyebrow" class="mb-eyebrow flex items-center gap-1.5" :class="sticky ? '' : 'mb-1'">
        <Icon v-if="eyebrowIcon" :name="eyebrowIcon" class="mb-icon-sm shrink-0" />
        {{ eyebrow }}
      </p>
      <h1
        class="flex items-center gap-2.5 font-display font-bold tracking-tight text-surface-950 dark:text-surface-50"
        :class="sticky ? 'text-lg leading-tight' : 'text-2xl'"
      >
        <span class="truncate" :title="title">{{ title }}</span>
        <span v-if="$slots.badge" class="flex shrink-0 items-center gap-2.5"><slot name="badge" /></span>
      </h1>
      <p v-if="$slots.description" class="mt-1 max-w-xl text-sm text-surface-500"><slot name="description" /></p>
    </div>
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </div>
</template>
