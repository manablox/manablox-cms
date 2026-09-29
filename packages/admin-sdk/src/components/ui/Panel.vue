<script setup lang="ts">
/** A titled section: title row with a spacer and actions, then the body. */
withDefaults(
  defineProps<{
    title: string;
    /** A line under the title; the row then aligns to the top. */
    description?: string | undefined;
    /** Title scale. */
    size?: 'sm' | 'base' | 'lg' | 'display';
    heading?: 'h2' | 'h3';
    /** Frames the panel as an mb-card. */
    card?: boolean;
    /** A count badge beside the title, e.g. `42` or `10000+`. */
    count?: number | string | undefined;
  }>(),
  { description: undefined, size: 'base', heading: 'h2', card: true, count: undefined },
);

const TITLE = {
  sm: 'text-sm font-bold',
  base: 'text-base font-bold',
  lg: 'text-lg font-semibold',
  display: 'font-display font-bold',
};
</script>

<template>
  <component :is="card ? 'section' : 'div'" :class="card ? 'mb-card' : ''">
    <div class="flex" :class="description ? 'mb-4 items-start gap-3' : 'mb-3 items-center'">
      <div v-if="description" class="min-w-0">
        <component :is="heading" :class="TITLE[size]">{{ title }}</component>
        <p class="text-sm text-surface-500">{{ description }}</p>
      </div>
      <component
        :is="heading"
        v-else
        :class="[TITLE[size], count !== undefined ? 'flex items-center gap-2' : '']"
      >
        {{ title }}
        <span v-if="count !== undefined" class="mb-badge">{{ count }}</span>
      </component>
      <div class="flex-1" />
      <slot name="actions" />
    </div>
    <slot />
  </component>
</template>
