<script setup lang="ts">
import { Icon, IconButton } from '@manablox/admin-sdk';
import { useLocalStorage } from '@vueuse/core';

/** First-visit hints above a canvas, one row of short tips; closing hides them for good. */
const props = defineProps<{
  id: string;
  tips: ReadonlyArray<{ icon: string; text: string }>;
}>();

const hidden = useLocalStorage(`manablox.design.tips.${props.id}`, false);
</script>

<template>
  <div v-if="!hidden" class="ws:flex ws:items-start ws:gap-3 ws:border-b ws:border-brand-200 ws:bg-brand-50 ws:px-3 ws:py-2 ws:text-xs ws:text-surface-700 ws:dark:border-brand-900 ws:dark:bg-brand-900/25 ws:dark:text-surface-300" role="note">
    <ul class="ws:grid ws:min-w-0 ws:flex-1 ws:gap-x-5 ws:gap-y-1 ws:sm:grid-cols-2 ws:xl:grid-cols-3">
      <li v-for="tip in tips" :key="tip.text" class="ws:flex ws:items-start ws:gap-1.5">
        <Icon :name="tip.icon" class="mb-icon-sm ws:mt-px ws:shrink-0 ws:text-brand-600 ws:dark:text-brand-400" />
        <span>{{ tip.text }}</span>
      </li>
    </ul>
    <IconButton icon="x" label="Hide these tips" title="Got it, hide these tips" class="ws:-my-1 ws:shrink-0" @click="hidden = true" />
  </div>
</template>
