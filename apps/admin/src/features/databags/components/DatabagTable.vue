<script setup lang="ts">
import DataTable, { type DataColumn } from '@manablox/admin-sdk/components/ui/DataTable.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import type { ContentListItem, ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { formatDate, formatDateTime } from '@manablox/admin-sdk/lib/format';
import { computed } from 'vue';
import type { DatabagSort } from '../queries';

/** A databag's entries, with a column per simple field and sortable title and date. */
const props = defineProps<{
  type: ContentTypeSummary;
  items: readonly ContentListItem[] | undefined;
  sort: DatabagSort;
  pending: boolean;
  error: unknown;
  retry: () => unknown;
  emptyTitle: string;
  emptyDescription: string;
}>();
const emit = defineEmits<{ sort: [by: DatabagSort['by']] }>();

/** Field types that read well in a cell. */
const CELL_TYPES = new Set(['string', 'number', 'boolean', 'select', 'date']);
const MAX_COLUMNS = 3;

const fields = computed(() =>
  [...props.type.fields]
    .filter((field) => CELL_TYPES.has(field.type))
    .sort((a, b) => a.admin.position - b.admin.position)
    .slice(0, MAX_COLUMNS),
);

const columns = computed<DataColumn<DatabagSort['by']>[]>(() => [
  {
    key: 'title',
    label: 'Title',
    sortBy: 'title',
    headerClass: 'w-full pr-3 pl-2',
    cellClass: 'max-w-0 py-2 pr-3 pl-2',
  },
  ...fields.value.map((field) => ({
    key: `field-${field.name}`,
    label: field.label,
    headerClass: 'pr-3 whitespace-nowrap',
    cellClass: 'max-w-[14rem] truncate pr-3 text-xs text-surface-600 dark:text-surface-300',
  })),
  ...(props.type.isPublishable
    ? [
        {
          key: 'status',
          label: 'Status',
          headerClass: 'pr-3 whitespace-nowrap',
          cellClass: 'pr-3 whitespace-nowrap',
        },
      ]
    : []),
  {
    key: 'updatedAt',
    label: 'Updated',
    sortBy: 'updatedAt' as const,
    headerClass: 'pr-2 whitespace-nowrap',
    cellClass: 'pr-2 text-xs whitespace-nowrap text-surface-500',
  },
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T|$)/;

function cell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return ISO_DATE.test(value) ? formatDate(value) : value;
  if (Array.isArray(value)) return value.map(cell).join(', ') || '-';
  return '-';
}

const to = (entry: ContentListItem) => `/databags/${props.type.id}/${entry.id}`;
</script>

<template>
  <DataTable
    :items="items"
    :columns="columns"
    :sort="sort"
    :row-to="to"
    :pending="pending"
    :error="error"
    :retry="retry"
    empty-icon="database"
    :empty-title="emptyTitle"
    :empty-description="emptyDescription"
    table-class="min-w-[36rem]"
    @sort="emit('sort', $event)"
  >
    <template v-if="$slots['empty-actions']" #empty-actions><slot name="empty-actions" /></template>
    <template #cell-title="{ item }">
      <!-- The link carries keyboard focus; the row click is a larger target for the pointer. -->
      <RouterLink :to="to(item)" class="block truncate font-medium hover:underline" @click.stop>
        {{ item.title || 'Untitled' }}
      </RouterLink>
    </template>
    <template v-for="field in fields" :key="field.id" #[`cell-field-${field.name}`]="{ item }">
      {{ cell(item.fields[field.name]) }}
    </template>
    <template #cell-status="{ item }">
      <StatusBadge :status="item.status === 'published' ? 'live' : 'draft'" />
    </template>
    <template #cell-updatedAt="{ item }">
      <span :title="formatDateTime(item.updatedAt)">{{ formatDate(item.updatedAt) }}</span>
    </template>
  </DataTable>
</template>
