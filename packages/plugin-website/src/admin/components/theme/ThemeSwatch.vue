<script setup lang="ts">
import type { ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import { fontStack, roleSwatches } from '../../model/ai-theme';
import { resolveColor } from '../../model/color';

/** A thumbnail of a theme: its heading font and button on the page color, over the palette. */
const props = defineProps<{
  theme: ThemeDesign;
  /** Fills its container instead of the small fixed size. */
  fill?: boolean;
}>();

const color = (role: string) => resolveColor(props.theme.colors, role) ?? 'transparent';
const swatches = computed(() => roleSwatches(props.theme));
const radius = computed(() => props.theme.radius.sm ?? '0px');
</script>

<template>
  <span
    class="ws:flex ws:shrink-0 ws:flex-col ws:overflow-hidden ws:rounded-control ws:border ws:border-surface-200 ws:dark:border-surface-700"
    :class="fill ? 'ws:h-16 ws:w-full' : 'ws:h-12 ws:w-20'"
    :style="{ background: color('bg'), color: color('text') }"
    aria-hidden="true"
  >
    <span class="ws:flex ws:flex-1 ws:items-center ws:justify-between ws:gap-1 ws:px-2">
      <span class="ws:text-lg ws:font-bold ws:leading-none" :style="{ fontFamily: fontStack(theme, 'heading') }">Aa</span>
      <span class="ws:h-3 ws:w-6" :style="{ background: color('primary'), borderRadius: radius }" />
    </span>
    <span class="ws:flex ws:h-2">
      <span v-for="swatch in swatches" :key="swatch.role" class="ws:flex-1" :style="{ background: swatch.color ?? 'transparent' }" />
    </span>
  </span>
</template>
