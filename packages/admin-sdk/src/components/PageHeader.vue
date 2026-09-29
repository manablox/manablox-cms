<script setup lang="ts">
/** Page title, description and actions. */
defineProps<{
  title: string;
  /** Label above the title. */
  eyebrow?: string;
  description?: string;
}>();
</script>

<template>
  <div class="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
    <div class="min-w-0">
      <p v-if="eyebrow" class="mb-eyebrow mb-1">{{ eyebrow }}</p>
      <h1 class="mb-title flex flex-wrap items-center gap-2.5">
        {{ title }}
        <slot name="badge" />
      </h1>
      <p v-if="description" class="mt-1 max-w-xl text-sm text-surface-500">{{ description }}</p>
    </div>
    <div class="flex-1" />
    <div v-if="$slots.default" class="flex flex-wrap items-center gap-2">
      <slot />
    </div>
  </div>
</template>
