<script setup lang="ts">
/** Vertical list of `NavListItem`s. */
defineProps<{ ariaLabel?: string | undefined }>();
</script>

<template>
  <ul class="mb-list" :aria-label="ariaLabel">
    <slot />
  </ul>
</template>
