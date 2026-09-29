<script setup lang="ts">
import Icon from '../Icon.vue';

/** Empty state: default block, `compact` for panels, `bare` single line for lists and menus. */
withDefaults(
  defineProps<{
    title: string;
    description?: string | undefined;
    icon?: string | undefined;
    compact?: boolean;
    bare?: boolean;
    fill?: boolean;
  }>(),
  { compact: false, bare: false, fill: false },
);
</script>

<template>
  <p v-if="bare" class="mb-list-empty">{{ title }}</p>
  <div v-else class="mb-empty" :class="[compact ? 'mb-empty-sm' : '', fill ? 'mb-empty-fill' : '']">
    <!-- The margin clears the halo ring. -->
    <span v-if="icon" class="mb-empty-icon" :class="compact ? 'mb-4' : 'mb-6'">
      <Icon :name="icon" :class="compact ? 'mb-icon' : 'mb-icon-lg'" />
    </span>
    <p class="mb-empty-title">{{ title }}</p>
    <p v-if="description" class="mb-empty-text mt-1">{{ description }}</p>
    <div v-if="$slots.default" class="mt-3"><slot /></div>
  </div>
</template>
