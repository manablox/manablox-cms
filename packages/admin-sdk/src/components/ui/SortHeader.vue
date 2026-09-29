<script setup lang="ts" generic="T extends string">
import { ariaSort, type SortState } from '../../composables/useSort';
import Icon from '../Icon.vue';

/** A sortable column header: a `<th>`, or a `columnheader` div for grid layouts. */
withDefaults(
  defineProps<{
    by: T;
    sort: SortState<T>;
    /** Falls back to the default slot. */
    label?: string | undefined;
    tag?: 'th' | 'div';
  }>(),
  { tag: 'th' },
);
const emit = defineEmits<{ sort: [by: T] }>();
</script>

<template>
  <th v-if="tag === 'th'" class="mb-th" scope="col" :aria-sort="ariaSort(sort, by)">
    <button
      type="button"
      class="inline-flex items-center gap-1 hover:text-surface-800 dark:hover:text-surface-200"
      @click="emit('sort', by)"
    >
      <slot>{{ label }}</slot>
      <Icon v-if="sort.by === by" :name="sort.direction === 'asc' ? 'up' : 'down'" class="mb-icon-sm" />
    </button>
  </th>
  <div v-else class="mb-th pb-2" role="columnheader" :aria-sort="ariaSort(sort, by)">
    <button
      type="button"
      class="inline-flex items-center gap-1 text-left transition hover:text-surface-800 dark:hover:text-surface-200"
      @click="emit('sort', by)"
    >
      <slot>{{ label }}</slot>
      <Icon v-if="sort.by === by" :name="sort.direction === 'asc' ? 'up' : 'down'" class="mb-icon-sm" />
    </button>
  </div>
</template>
