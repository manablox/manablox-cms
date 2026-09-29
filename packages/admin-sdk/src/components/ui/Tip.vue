<script setup lang="ts">
import Icon from '../Icon.vue';

/** A neutral note with a hint icon. */
withDefaults(defineProps<{ icon?: string }>(), { icon: 'lightbulb' });
</script>

<template>
  <div class="mb-surface-inset flex items-start gap-2.5 rounded-card px-3 py-2.5 text-sm text-surface-700 dark:text-surface-300">
    <Icon :name="icon" class="mb-icon mt-0.5 shrink-0 text-surface-500" />
    <div class="min-w-0 flex-1"><slot /></div>
  </div>
</template>
