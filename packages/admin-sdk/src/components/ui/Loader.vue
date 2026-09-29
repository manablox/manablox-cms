<script setup lang="ts">
/** Loading spinner; `inline` is text-sized, the default is centred with padding. */
withDefaults(
  defineProps<{
    label?: string | null;
    inline?: boolean;
    /** Diameter in px. */
    size?: number;
  }>(),
  { label: 'Loading...', inline: false, size: 18 },
);
</script>

<template>
  <span
    v-if="inline"
    class="inline-flex items-center gap-2 text-surface-500"
    role="status"
    aria-live="polite"
  >
    <span class="mb-spinner shrink-0" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
    <span v-if="label">{{ label }}</span>
  </span>
  <div
    v-else
    class="flex items-center justify-center gap-3 py-8 text-sm text-surface-500"
    role="status"
    aria-live="polite"
  >
    <span class="mb-spinner shrink-0" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
    <span v-if="label">{{ label }}</span>
  </div>
</template>
