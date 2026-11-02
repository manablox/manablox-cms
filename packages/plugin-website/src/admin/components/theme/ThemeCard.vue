<script setup lang="ts">
import { Radio } from '@manablox/admin-sdk';
import type { ThemeDesign } from '@manablox/site';
import ThemeSwatch from './ThemeSwatch.vue';

/** A starter theme to pick: its swatch over the name. */
const model = defineModel<string>({ required: true });
defineProps<{
  value: string;
  label: string;
  description: string;
  theme: ThemeDesign;
  name: string;
}>();
</script>

<template>
  <div
    class="ws:flex ws:cursor-pointer ws:flex-col ws:gap-2 ws:rounded-control ws:border ws:p-2 ws:text-sm ws:transition"
    :class="
      model === value
        ? 'ws:border-brand-500 ws:bg-brand-50 ws:dark:border-brand-400 ws:dark:bg-brand-600/15'
        : 'ws:border-surface-200 ws:hover:border-surface-300 ws:dark:border-surface-700 ws:dark:hover:border-surface-600'
    "
    :title="description"
    @click="model = value"
  >
    <ThemeSwatch :theme="theme" fill />
    <Radio v-model="model" :name="name" :value="value">
      <span class="ws:font-medium">{{ label }}</span>
    </Radio>
  </div>
</template>
