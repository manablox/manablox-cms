<script setup lang="ts">
import type { ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import { fontStack, roleSwatches } from '../model/ai-theme';
import { resolveColor } from '../model/color';

/** A small style guide drawn from a theme's tokens: colors, heading and body type, a button. */
const props = defineProps<{ theme: ThemeDesign; title?: string | undefined }>();

const color = (role: string) => resolveColor(props.theme.colors, role) ?? 'transparent';
const swatches = computed(() => roleSwatches(props.theme));
const radius = computed(() => props.theme.radius.md ?? props.theme.radius.sm ?? '0px');
</script>

<template>
  <span class="ws:block ws:overflow-hidden ws:rounded-control ws:border ws:border-surface-200 ws:dark:border-surface-800" :style="{ background: color('bg'), color: color('text') }">
    <span class="ws:block ws:space-y-2 ws:p-3">
      <span class="ws:block ws:truncate ws:text-lg ws:font-bold ws:leading-tight" :style="{ fontFamily: fontStack(theme, 'heading') }">{{ title || 'A heading' }}</span>
      <span class="ws:line-clamp-2 ws:text-xs" :style="{ fontFamily: fontStack(theme, 'body'), color: color('muted') }">
        Body text as visitors read it, with <span :style="{ color: color('primary'), textDecoration: 'underline' }">a link</span>.
      </span>
      <span class="ws:flex ws:items-center ws:gap-2">
        <span class="ws:px-2.5 ws:py-1 ws:text-xs ws:font-semibold" :style="{ background: color('primary'), color: color('onPrimary'), borderRadius: radius }">Button</span>
        <span class="ws:px-2.5 ws:py-1 ws:text-xs" :style="{ background: color('surface'), border: `1px solid ${color('border')}`, borderRadius: radius }">Card</span>
      </span>
    </span>
    <span class="ws:flex ws:h-3" aria-hidden="true">
      <span v-for="swatch in swatches" :key="swatch.role" class="ws:flex-1" :title="swatch.label" :style="{ background: swatch.color ?? 'transparent' }" />
    </span>
  </span>
</template>
