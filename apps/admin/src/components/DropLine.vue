<script setup lang="ts">
/** Drop target between sortable rows; fixed height so it does not shift mid-drag. */
defineProps<{ active: boolean }>();
</script>

<template>
  <div class="relative h-2.5">
    <div
      v-if="active"
      class="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-brand-500 before:absolute before:top-1/2 before:-left-1 before:h-2.5 before:w-2.5 before:-translate-y-1/2 before:rounded-pill before:bg-brand-500"
    />
  </div>
</template>
