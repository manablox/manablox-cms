<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';

/** Collapsed side panel strip with an expand button and vertical label. */
defineProps<{ label: string }>();
const emit = defineEmits<{ expand: [] }>();
</script>

<template>
  <aside class="flex w-9 shrink-0 flex-col items-center border-r border-surface-200 mb-surface-panel dark:border-surface-800">
    <button
      class="mt-2 rounded-control p-1.5 text-surface-500 transition hover:bg-surface-200 hover:text-surface-900 dark:hover:bg-surface-800 dark:hover:text-surface-100"
      :title="`Show ${label.toLowerCase()}`"
      :aria-label="`Show ${label.toLowerCase()}`"
      @click="emit('expand')"
    >
      <Icon name="panel-open" class="mb-icon" />
    </button>
    <span class="mt-3 text-2xs font-semibold tracking-[0.14em] text-surface-500 uppercase [writing-mode:vertical-rl]">
      {{ label }}
    </span>
  </aside>
</template>
