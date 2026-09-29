<script setup lang="ts" generic="T extends string | number">
import { toggleInList } from '../../lib/collections';
import ChipToggle from './ChipToggle.vue';
import type { ChipOption } from './types';

/** A labelled multi-pick of toggle chips; emits a new array on every toggle. */

export type { ChipOption };

const model = defineModel<T[]>({ required: true });
withDefaults(
  defineProps<{
    legend: string;
    options: readonly ChipOption<T>[];
    mono?: boolean;
    disabled?: boolean;
    /** Under the chips, such as what none selected means. */
    hint?: string | undefined;
    /** Shown instead of the chips when there are no options. */
    emptyHint?: string | undefined;
    error?: string | null | undefined;
  }>(),
  { mono: false, disabled: false },
);
</script>

<template>
  <fieldset>
    <legend class="mb-label">{{ legend }}</legend>
    <p v-if="!options.length && emptyHint" class="mb-hint">{{ emptyHint }}</p>
    <div v-else class="flex flex-wrap gap-1.5">
      <ChipToggle
        v-for="option in options"
        :key="String(option.value)"
        :title="option.title"
        :mono="mono"
        :disabled="disabled"
        :model-value="model.includes(option.value)"
        @update:model-value="model = toggleInList(model, option.value)"
      >
        {{ option.label }}
      </ChipToggle>
    </div>
    <p v-if="hint && (options.length || !emptyHint)" class="mb-hint">{{ hint }}</p>
    <p v-if="error" class="mb-error">{{ error }}</p>
  </fieldset>
</template>
