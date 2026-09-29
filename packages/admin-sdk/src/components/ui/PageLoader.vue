<script setup lang="ts">
import Loader from './Loader.vue';

/** Full-page loader. */
withDefaults(defineProps<{ label?: string }>(), { label: 'Loading...' });
</script>

<template>
  <div class="flex h-full min-h-64 items-center justify-center">
    <Loader :label="label" />
  </div>
</template>
