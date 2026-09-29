<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { computed } from 'vue';
import { theme } from '~/lib/theme';

/** Cycles light, dark, system; the icon shows the setting, not the rendered theme. */
const label = computed(() => {
  switch (theme.preference.value) {
    case 'light':
      return 'Light theme - click for dark';
    case 'dark':
      return 'Dark theme - click to follow the system';
    default:
      return `System theme (${theme.isDark.value ? 'dark' : 'light'}) - click for light`;
  }
});
const icon = computed(() =>
  theme.preference.value === 'light'
    ? 'sun'
    : theme.preference.value === 'dark'
      ? 'moon'
      : 'monitor',
);
</script>

<template>
  <button
    type="button"
    class="rounded-control p-1.5 text-surface-500 transition hover:bg-surface-100 hover:text-surface-900 dark:hover:bg-surface-800 dark:hover:text-surface-100"
    :title="label"
    :aria-label="label"
    @click="theme.cycle()"
  >
    <Icon :name="icon" class="mb-icon" />
  </button>
</template>
