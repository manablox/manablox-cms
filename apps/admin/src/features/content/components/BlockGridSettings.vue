<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import NumberField from '@manablox/admin-sdk/components/ui/NumberField.vue';
import {
  BREAKPOINTS,
  type resolveBlockGrid,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import type { BlockBreakpoint, BlockGrid, BlockGridValue } from '@manablox/core';
import { ref } from 'vue';

/** A blocks field's grid per breakpoint; off (a single column) by default. */
const props = defineProps<{
  /** The stored grid; a breakpoint without one uses its default. */
  value: BlockGridValue | undefined;
  /** The grid in effect, defaults filled in. */
  grid: ReturnType<typeof resolveBlockGrid>;
  isGrid: boolean;
  readOnly: boolean;
}>();
const emit = defineEmits<{
  /** `null` resets the breakpoint to its default. */
  set: [breakpoint: BlockBreakpoint, patch: Partial<BlockGrid> | null];
}>();

const open = ref(false);

/** What an unset breakpoint falls back to. */
const DEFAULTS: Partial<Record<BlockBreakpoint, string>> = {
  tablet: '(as desktop)',
  mobile: '(one column)',
};

const at = (breakpoint: BlockBreakpoint): BlockGrid | undefined => props.value?.[breakpoint];

/** Clearing the columns resets the breakpoint to its default. */
function onColumns(breakpoint: BlockBreakpoint, columns: number | undefined | null) {
  emit('set', breakpoint, columns ? { columns } : null);
}

function onRows(breakpoint: BlockBreakpoint, rows: number | undefined | null) {
  emit('set', breakpoint, { rows: rows ?? undefined });
}
</script>

<template>
  <div class="rounded-card border border-surface-200 dark:border-surface-700">
    <div class="flex items-center gap-2 px-3 py-2">
      <Icon name="grid" class="mb-icon text-surface-500" aria-hidden="true" />
      <span class="text-sm font-medium">Layout</span>
      <span class="mb-meta">
        {{ isGrid ? BREAKPOINTS.map((b) => `${b.label} ${grid[b.value].columns}`).join(' - ') : 'Single column' }}
      </span>
      <span class="flex-1" />
      <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" :aria-expanded="open" @click="open = !open">
        {{ open ? 'Done' : isGrid ? 'Change grid' : 'Use a grid' }}
      </button>
    </div>
    <div v-if="open && !readOnly" class="grid gap-3 border-t border-surface-200 px-3 py-3 sm:grid-cols-3 dark:border-surface-700">
      <div v-for="entry in BREAKPOINTS" :key="entry.value" class="space-y-1.5">
        <div class="flex items-center gap-1.5 text-xs font-medium">
          <Icon :name="entry.icon" class="mb-icon-sm text-surface-500" aria-hidden="true" />
          {{ entry.label }}
          <span v-if="!at(entry.value)" class="font-normal text-surface-500">{{ DEFAULTS[entry.value] ?? '' }}</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <NumberField
            :model-value="at(entry.value)?.columns"
            label="Columns"
            :min="1"
            :max="12"
            class="mb-input-sm"
            :aria-label="`${entry.label} columns`"
            :placeholder="String(grid[entry.value].columns)"
            @update:model-value="onColumns(entry.value, $event)"
          />
          <NumberField
            :model-value="at(entry.value)?.rows"
            label="Rows"
            :min="1"
            :max="100"
            class="mb-input-sm"
            :aria-label="`${entry.label} rows`"
            placeholder="auto"
            :disabled="!at(entry.value)"
            @update:model-value="onRows(entry.value, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
