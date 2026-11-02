<script setup lang="ts">
import { Select } from '@manablox/admin-sdk';
import { THEME_CATEGORIES, type ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import ThemeSwatch from './ThemeSwatch.vue';

/** A starter theme to pick; `category` null is a theme from the project's code. */
interface StarterThemeOption {
  value: string;
  name: string;
  description: string;
  category: string | null;
  theme: ThemeDesign;
}

/**
 * Starter themes grouped by category, each with a swatch. `extra` options (no swatch) come
 * first, e.g. keeping the stored theme.
 */
const model = defineModel<string>({ required: true });
const props = defineProps<{
  themes: readonly StarterThemeOption[];
  extra?: ReadonlyArray<{ value: string; label: string; description: string }> | undefined;
  id?: string | undefined;
}>();

const LABELS: Record<string, string> = Object.fromEntries(
  THEME_CATEGORIES.map((entry) => [entry.id, entry.label]),
);
const ORDER: string[] = THEME_CATEGORIES.map((entry) => entry.id);

const options = computed(() => [
  ...(props.extra ?? []),
  ...[...props.themes]
    .sort((a, b) => rank(a.category) - rank(b.category))
    .map((entry) => ({
      value: entry.value,
      label: entry.name,
      description: entry.description,
      group: entry.category ? (LABELS[entry.category] ?? entry.category) : 'From your project',
    })),
]);

// Stable sort, so themes keep their order within a category; code themes last.
function rank(category: string | null): number {
  const index = category ? ORDER.indexOf(category) : -1;
  return index < 0 ? ORDER.length : index;
}

const themeOf = (value: unknown) => props.themes.find((entry) => entry.value === value)?.theme;
</script>

<template>
  <Select :id="id" v-model="model" :options="options">
    <template #leading="{ option }">
      <ThemeSwatch v-if="themeOf(option.value)" :theme="themeOf(option.value)!" />
    </template>
  </Select>
</template>
