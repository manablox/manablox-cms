<script setup lang="ts">
/** A determinate progress bar; `tone="danger"` for a stopped one, `warn` for one near its end. */
withDefaults(defineProps<{ value: number; label: string; tone?: 'brand' | 'warn' | 'danger' }>(), {
  tone: 'brand',
});

const TONES = { brand: 'bg-brand-500', warn: 'bg-warn-500', danger: 'bg-danger-500' };
</script>

<template>
  <div
    class="h-2 w-full overflow-hidden rounded-pill bg-surface-200 dark:bg-surface-800"
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="value"
  >
    <div
      class="h-full rounded-pill transition-[width]"
      :class="TONES[tone]"
      :style="{ width: `${Math.max(0, Math.min(100, value))}%` }"
    />
  </div>
</template>
