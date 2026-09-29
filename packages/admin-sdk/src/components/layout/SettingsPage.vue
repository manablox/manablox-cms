<script setup lang="ts">
/** A settings section: title, a plain description and actions, then its blocks. */
withDefaults(
  defineProps<{
    title: string;
    description: string;
    /** Drops the reading width, for list and detail layouts. */
    wide?: boolean;
  }>(),
  { wide: false },
);
</script>

<template>
  <div class="space-y-6" :class="wide ? '' : 'max-w-4xl'">
    <header class="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div class="min-w-0 flex-1">
        <h1 class="text-lg font-semibold">{{ title }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-surface-500">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </div>
</template>
