<script setup lang="ts">
import { computed } from 'vue';

/**
 * A 3 by 3 pad that places children like a picture on a wall: the column and row of the
 * pressed dot become `justify` and `align`, swapped for a column layout.
 */
const props = defineProps<{
  justify: string | undefined;
  align: string | undefined;
  /** Shown faded when nothing is set here. */
  inheritedJustify?: string | undefined;
  inheritedAlign?: string | undefined;
  axis: 'row' | 'column';
  disabled?: boolean;
}>();
const emit = defineEmits<{ place: [justify: string, align: string] }>();

const STEPS = ['start', 'center', 'end'] as const;
const ROW_NAMES = { start: 'top', center: 'middle', end: 'bottom' } as const;
const COL_NAMES = { start: 'left', center: 'center', end: 'right' } as const;

const cells = computed(() =>
  STEPS.flatMap((row) =>
    STEPS.map((col) => {
      const justify = props.axis === 'row' ? col : row;
      const align = props.axis === 'row' ? row : col;
      const own = props.justify === justify && props.align === align;
      const inherited =
        !props.justify &&
        !props.align &&
        props.inheritedJustify === justify &&
        props.inheritedAlign === align;
      return {
        key: `${row}-${col}`,
        justify,
        align,
        own,
        inherited,
        name: `${ROW_NAMES[row]} ${COL_NAMES[col]}`,
      };
    }),
  ),
);
</script>

<template>
  <div class="ws:grid ws:w-24 ws:shrink-0 ws:grid-cols-3 ws:gap-0.5 ws:rounded-control ws:border ws:border-surface-200 ws:bg-surface-50 ws:p-1 ws:dark:border-surface-700 ws:dark:bg-surface-800" role="group" aria-label="Position of the content">
    <button
      v-for="cell in cells"
      :key="cell.key"
      type="button"
      class="ws:group ws:flex ws:h-6 ws:items-center ws:justify-center ws:rounded-sm ws:hover:bg-surface-200 ws:disabled:opacity-50 ws:dark:hover:bg-surface-700"
      :aria-label="`Place content ${cell.name}`"
      :title="`Place content ${cell.name}`"
      :aria-pressed="cell.own"
      :disabled="disabled"
      @click="emit('place', cell.justify, cell.align)"
    >
      <span
        class="ws:block ws:rounded-pill ws:transition-all"
        :class="cell.own ? 'ws:h-3 ws:w-3 ws:bg-brand-500' : cell.inherited ? 'ws:h-2.5 ws:w-2.5 ws:border-2 ws:border-dashed ws:border-surface-400' : 'ws:h-1.5 ws:w-1.5 ws:bg-surface-300 ws:group-hover:bg-surface-500 ws:dark:bg-surface-600'"
      />
    </button>
  </div>
</template>
