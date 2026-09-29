<script setup lang="ts">
/** Loading placeholder that reserves layout; decorative, so no live region. */
withDefaults(
  defineProps<{
    variant?: 'rows' | 'grid' | 'table';
    count?: number;
  }>(),
  { variant: 'rows', count: 6 },
);
</script>

<template>
  <div v-if="variant === 'grid'" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
    <span v-for="index in count" :key="index" class="mb-skeleton aspect-square rounded-card" />
  </div>
  <div v-else class="flex flex-col" :class="variant === 'table' ? 'gap-px' : 'gap-1.5'" aria-hidden="true">
    <span
      v-for="index in count"
      :key="index"
      class="mb-skeleton"
      :style="{
        height: variant === 'table' ? 'var(--mb-control-h-lg)' : 'var(--mb-control-h)',
        width: `${88 - ((index * 13) % 26)}%`,
      }"
    />
  </div>
</template>
