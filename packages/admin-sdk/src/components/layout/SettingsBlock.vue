<script setup lang="ts">
/** A titled group of blocks on a settings page. */
defineProps<{ title: string; description?: string | undefined }>();
</script>

<template>
  <section class="space-y-3">
    <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-bold">{{ title }}</h2>
        <p v-if="description" class="max-w-2xl text-sm text-surface-500">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>
