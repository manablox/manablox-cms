<script setup lang="ts" generic="T">
import { messageFor } from '../../lib/messages';
import EmptyState from './EmptyState.vue';
import Pager from './Pager.vue';
import Skeleton from './Skeleton.vue';

/**
 * The states of a fetched list: skeleton rows while pending, a retry on error, an empty
 * state, else the items. With an `item` slot it renders the divided list itself; the
 * default slot gets `items` for any other layout. With `pageSize` (and `v-model:page` and
 * `total`) a pager follows the items.
 */
const props = withDefaults(
  defineProps<{
    pending: boolean;
    items: readonly T[] | null | undefined;
    error?: unknown;
    /** Refetches after a failure; without it no retry button shows. */
    retry?: (() => unknown) | undefined;
    /** Skeleton shape and row count while pending. */
    skeleton?: 'rows' | 'table' | 'grid';
    rows?: number;
    emptyTitle?: string;
    emptyDescription?: string | undefined;
    emptyIcon?: string | undefined;
    /** Empty state size; `bare` is a single line. */
    empty?: 'compact' | 'block' | 'bare';
    /** The list built around the `item` slot. */
    tag?: 'ul' | 'ol';
    listClass?: string;
    itemClass?: string;
    /** The row key; `id` when the item has one, else the index. */
    itemKey?: ((item: T) => PropertyKey) | undefined;
    /** Rows per page; set, a pager follows the items. */
    pageSize?: number | undefined;
    /** Every row, for the pager. */
    total?: number;
    previousLabel?: string | undefined;
    nextLabel?: string | undefined;
  }>(),
  {
    retry: undefined,
    skeleton: 'rows',
    rows: 4,
    emptyTitle: 'Nothing yet',
    emptyDescription: undefined,
    emptyIcon: undefined,
    empty: 'compact',
    tag: 'ul',
    listClass: '',
    itemClass: '',
    itemKey: undefined,
    pageSize: undefined,
    total: 0,
    previousLabel: undefined,
    nextLabel: undefined,
  },
);
const page = defineModel<number>('page', { default: 0 });

function keyOf(item: T, index: number): PropertyKey {
  if (props.itemKey) return props.itemKey(item);
  const id = (item as { id?: PropertyKey } | null)?.id;
  return id ?? index;
}
</script>

<template>
  <Skeleton v-if="pending" :variant="skeleton" :count="rows" />
  <slot v-else-if="error" name="error" :error="error" :message="messageFor(error)" :retry="retry">
    <div class="flex flex-wrap items-center gap-2" role="alert">
      <p class="mb-error mt-0">{{ messageFor(error) }}</p>
      <button v-if="retry" type="button" class="mb-btn-ghost mb-btn-sm" @click="retry()">
        Try again
      </button>
    </div>
  </slot>
  <slot v-else-if="!items?.length" name="empty">
    <EmptyState
      :bare="empty === 'bare'"
      :compact="empty === 'compact'"
      :icon="emptyIcon"
      :title="emptyTitle"
      :description="emptyDescription"
    >
      <template v-if="$slots['empty-actions']" #default>
        <slot name="empty-actions" />
      </template>
    </EmptyState>
  </slot>
  <component :is="tag" v-else-if="$slots.item" class="mb-list-divided" :class="listClass">
    <li v-for="(item, index) in items" :key="keyOf(item, index)" :class="itemClass">
      <slot name="item" :item="item" :index="index" />
    </li>
  </component>
  <slot v-else :items="items" />
  <Pager
    v-if="pageSize !== undefined && !pending && !error && items?.length"
    v-model:page="page"
    :total="total"
    :page-size="pageSize"
    :previous-label="previousLabel"
    :next-label="nextLabel"
    class="mt-3 justify-end border-t border-surface-200 pt-2 dark:border-surface-800"
  />
</template>
