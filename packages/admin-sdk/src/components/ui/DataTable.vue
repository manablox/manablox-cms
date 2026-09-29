<script setup lang="ts" generic="T extends { id: string }, S extends string = string">
import { computed } from 'vue';
import { type RouteLocationRaw, useRouter } from 'vue-router';
import type { SortState } from '../../composables/useSort';
import AsyncList from './AsyncList.vue';
import Checkbox from './Checkbox.vue';
import SortHeader from './SortHeader.vue';
import type { DataColumn } from './types';

export type { DataColumn };

/**
 * A table of records with sortable headers, a row link or row click, and an optional
 * checkbox column. Pending, error and empty states follow `AsyncList`. Cells render through
 * `#cell-<key>` slots, else the item's value at `key`.
 */
const props = withDefaults(
  defineProps<{
    items: readonly T[] | null | undefined;
    columns: readonly DataColumn<S>[];
    sort?: SortState<S> | undefined;
    /** The whole row navigates here; the first link in the row should carry keyboard focus. */
    rowTo?: ((item: T) => RouteLocationRaw) | undefined;
    /** Adds the checkbox column; `rowClick` then toggles too. */
    selectable?: boolean;
    isSelected?: ((id: string) => boolean) | undefined;
    /** Names the row checkbox; defaults to the id. */
    rowLabel?: ((item: T) => string) | undefined;
    pending?: boolean;
    error?: unknown;
    retry?: (() => unknown) | undefined;
    emptyTitle?: string;
    emptyDescription?: string | undefined;
    emptyIcon?: string | undefined;
    /** Classes on the `<table>`, such as a minimum width. */
    tableClass?: string;
  }>(),
  {
    selectable: false,
    pending: false,
    emptyTitle: 'Nothing yet',
    tableClass: '',
  },
);
const emit = defineEmits<{
  sort: [by: S];
  /** A row click (without `rowTo`), or its checkbox with `{ ctrlKey: true }`. */
  rowClick: [item: T, event: MouseEvent | KeyboardEvent | { ctrlKey: true }];
  selectAll: [];
  clear: [];
}>();

defineSlots<
  {
    [K in `cell-${string}`]?: (props: { item: T; index: number }) => unknown;
  } & {
    [K in `header-${string}`]?: (props: { column: DataColumn<S> }) => unknown;
  } & {
    empty?: () => unknown;
    'empty-actions'?: () => unknown;
  }
>();

const router = useRouter();
const linked = computed(() => props.rowTo !== undefined);

const selected = (item: T) => props.selectable && (props.isSelected?.(item.id) ?? false);
const selectedCount = computed(() => (props.items ?? []).filter(selected).length);
const allSelected = computed(
  () => selectedCount.value > 0 && selectedCount.value === (props.items?.length ?? 0),
);

function onRow(item: T, event: MouseEvent | KeyboardEvent) {
  if (props.rowTo) void router.push(props.rowTo(item));
  else emit('rowClick', item, event);
}

const cellValue = (item: T, key: string): unknown => (item as Record<string, unknown>)[key];
</script>

<template>
  <AsyncList
    :pending="pending"
    :error="error"
    :retry="retry"
    :items="items"
    skeleton="table"
    empty="block"
    :empty-title="emptyTitle"
    :empty-description="emptyDescription"
    :empty-icon="emptyIcon"
  >
    <template v-if="$slots.empty" #empty><slot name="empty" /></template>
    <template v-if="$slots['empty-actions']" #empty-actions><slot name="empty-actions" /></template>

    <div class="overflow-x-auto">
      <table class="mb-table border-separate border-spacing-0" :class="tableClass">
        <thead>
          <tr>
            <th v-if="selectable" class="mb-th w-8 pl-2" scope="col">
              <Checkbox
                :model-value="allSelected"
                :indeterminate="!allSelected && selectedCount > 0"
                aria-label="Select all"
                @update:model-value="allSelected ? emit('clear') : emit('selectAll')"
              />
            </th>
            <template v-for="column in columns" :key="column.key">
              <SortHeader
                v-if="column.sortBy && sort"
                :by="column.sortBy"
                :sort="sort"
                :class="column.headerClass"
                @sort="emit('sort', $event)"
              >
                <slot :name="`header-${column.key}`" :column="column">{{ column.label }}</slot>
              </SortHeader>
              <th v-else class="mb-th" :class="column.headerClass" scope="col">
                <slot :name="`header-${column.key}`" :column="column">
                  <span :class="column.hideLabel ? 'sr-only' : ''">{{ column.label }}</span>
                </slot>
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in items"
            :key="item.id"
            :data-id="item.id"
            class="mb-tr-interactive cursor-pointer transition [&>td]:mb-td [&>td]:border-t [&>td]:border-surface-200 dark:[&>td]:border-surface-800"
            :class="selected(item) ? 'mb-tr-active' : ''"
            :aria-selected="selectable ? selected(item) : undefined"
            :tabindex="linked ? undefined : 0"
            @click="onRow(item, $event)"
            @keydown.enter="linked ? undefined : onRow(item, $event)"
          >
            <td v-if="selectable" class="pl-2">
              <Checkbox
                :model-value="selected(item)"
                :aria-label="`Select ${rowLabel?.(item) ?? item.id}`"
                @click.stop
                @update:model-value="emit('rowClick', item, { ctrlKey: true })"
              />
            </td>
            <td v-for="column in columns" :key="column.key" :class="column.cellClass">
              <slot :name="`cell-${column.key}`" :item="item" :index="index">{{ cellValue(item, column.key) ?? '-' }}</slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </AsyncList>
</template>
