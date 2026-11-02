<script setup lang="ts">
import { Icon } from '@manablox/admin-sdk';

/** The inspector with nothing selected: what to do next, step by step. */
withDefaults(defineProps<{ readOnly?: boolean; extra?: string | undefined }>(), {
  readOnly: false,
});
</script>

<template>
  <div class="ws:rounded-card ws:border ws:border-dashed ws:border-surface-300 ws:px-4 ws:py-5 ws:text-center ws:dark:border-surface-700">
    <span class="ws:mx-auto ws:flex ws:h-10 ws:w-10 ws:items-center ws:justify-center ws:rounded-pill ws:bg-surface-100 ws:text-surface-500 ws:dark:bg-surface-800">
      <Icon name="mouse-pointer-2" class="mb-icon" />
    </span>
    <p class="ws:mt-3 ws:text-sm ws:font-semibold">Nothing selected</p>
    <p class="ws:mt-1 mb-meta">
      Click any part of the preview, or a row under Layers, to see and change it here.
    </p>
    <ul v-if="!readOnly" class="ws:mt-4 ws:space-y-2 ws:text-left ws:text-xs ws:text-surface-600 ws:dark:text-surface-400">
      <li class="ws:flex ws:gap-2">
        <Icon name="file-pen" class="mb-icon-sm ws:mt-px ws:shrink-0 ws:text-surface-400" />
        <span><strong class="ws:font-semibold">Content</strong> picks which field an element shows, or its own text.</span>
      </li>
      <li class="ws:flex ws:gap-2">
        <Icon name="palette" class="mb-icon-sm ws:mt-px ws:shrink-0 ws:text-surface-400" />
        <span><strong class="ws:font-semibold">Style</strong> sets colors, spacing and size, per screen size.</span>
      </li>
      <li class="ws:flex ws:gap-2">
        <Icon name="eye" class="mb-icon-sm ws:mt-px ws:shrink-0 ws:text-surface-400" />
        <span><strong class="ws:font-semibold">Visibility</strong> hides an element on some screens or when a field is empty.</span>
      </li>
      <li v-if="extra" class="ws:flex ws:gap-2">
        <Icon name="lightbulb" class="mb-icon-sm ws:mt-px ws:shrink-0 ws:text-surface-400" />
        <span>{{ extra }}</span>
      </li>
    </ul>
  </div>
</template>
