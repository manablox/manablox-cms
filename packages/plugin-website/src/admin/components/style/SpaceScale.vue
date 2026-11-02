<script setup lang="ts">
import type { ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import { lengthPx } from '../../model/style-visual';
import { tokenOptions } from '../../model/tokens';

/** The theme's spacing steps drawn as bars, plus plain values like `0` and `auto`. */
const props = defineProps<{
  modelValue: string | undefined;
  theme: ThemeDesign;
  extra?: readonly string[] | undefined;
  inherited?: string | undefined;
}>();
const emit = defineEmits<{ pick: [value: string] }>();

const steps = computed(() => {
  const tokens = tokenOptions(props.theme, 'space').filter((option) => option.label !== '0');
  const max = Math.max(1, ...tokens.map((option) => lengthPx(option.hint) ?? 0));
  return tokens.map((option) => ({
    ...option,
    width: Math.max(4, ((lengthPx(option.hint) ?? 0) / max) * 100),
  }));
});
</script>

<template>
  <div class="ws:space-y-1">
    <div v-if="extra?.length" class="ws:flex ws:gap-1">
      <button
        v-for="value in extra"
        :key="value"
        type="button"
        class="ws:flex-1 ws:rounded-control ws:border ws:px-2 ws:py-1 ws:text-xs ws:font-medium"
        :class="modelValue === value ? 'ws:border-brand-500 ws:bg-brand-50 ws:text-brand-700 ws:dark:bg-brand-900/30 ws:dark:text-brand-200' : 'ws:border-surface-200 ws:hover:bg-surface-50 ws:dark:border-surface-700 ws:dark:hover:bg-surface-800'"
        :aria-pressed="modelValue === value"
        @click="emit('pick', value)"
      >
        {{ value === '0' ? 'None' : value }}
      </button>
    </div>
    <ul class="ws:max-h-64 ws:space-y-px ws:overflow-y-auto" role="listbox" aria-label="Spacing steps">
      <li v-for="step in steps" :key="step.value">
        <button
          type="button"
          role="option"
          class="ws:flex ws:w-full ws:items-center ws:gap-2 ws:rounded-control ws:px-1.5 ws:py-1 ws:text-left"
          :class="modelValue === step.value ? 'ws:bg-brand-50 ws:text-brand-700 ws:dark:bg-brand-900/30 ws:dark:text-brand-200' : 'ws:hover:bg-surface-100 ws:dark:hover:bg-surface-800'"
          :aria-selected="modelValue === step.value"
          :aria-label="`Step ${step.label}, ${step.hint}`"
          @click="emit('pick', step.value)"
        >
          <span class="ws:w-6 ws:shrink-0 ws:text-right ws:font-mono ws:text-xs ws:tabular-nums">{{ step.label }}</span>
          <span class="ws:h-2.5 ws:min-w-0 ws:flex-1">
            <span
              class="ws:block ws:h-full ws:rounded-sm"
              :class="modelValue === step.value ? 'ws:bg-brand-500' : inherited === step.value ? 'ws:bg-surface-400' : 'ws:bg-surface-300 ws:dark:bg-surface-600'"
              :style="{ width: `${step.width}%` }"
            />
          </span>
          <span class="ws:w-14 ws:shrink-0 ws:text-right ws:font-mono ws:text-2xs ws:text-surface-500">{{ step.hint }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
