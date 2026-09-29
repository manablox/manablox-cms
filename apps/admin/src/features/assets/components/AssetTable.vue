<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import DataTable, { type DataColumn } from '@manablox/admin-sdk/components/ui/DataTable.vue';
import { type Asset, imageEditsOf } from '@manablox/admin-sdk/features/assets/queries';
import { formatBytes, formatDate } from '@manablox/admin-sdk/lib/format';
import { computed } from 'vue';

/** The library as a table, with a checkbox column for keyboard and touch selection. */
const props = defineProps<{
  items: readonly Asset[];
  isSelected: (id: string) => boolean;
}>();
const emit = defineEmits<{
  select: [asset: Asset, event: MouseEvent | KeyboardEvent | { ctrlKey: true }];
  selectAll: [];
  clear: [];
}>();

const COLUMNS: DataColumn[] = [
  {
    key: 'preview',
    label: 'Preview',
    hideLabel: true,
    headerClass: 'w-16 pr-4 pl-2',
    cellClass: 'pr-4 pl-2',
  },
  { key: 'name', label: 'Name', headerClass: 'w-full pr-3', cellClass: 'max-w-0 py-1.5 pr-3' },
  {
    key: 'mimeType',
    label: 'Type',
    headerClass: 'pr-3 whitespace-nowrap',
    cellClass: 'pr-3 font-mono text-xs whitespace-nowrap text-surface-500',
  },
  {
    key: 'size',
    label: 'Size',
    headerClass: 'pr-3 text-right whitespace-nowrap',
    cellClass: 'pr-3 text-right text-xs whitespace-nowrap tabular-nums',
  },
  {
    key: 'pixels',
    label: 'Pixels',
    headerClass: 'pr-3 text-right whitespace-nowrap',
    cellClass: 'pr-3 text-right text-xs whitespace-nowrap tabular-nums',
  },
  {
    key: 'edits',
    label: 'Edits',
    headerClass: 'pr-3 whitespace-nowrap',
    cellClass: 'pr-3 text-xs whitespace-nowrap',
  },
  {
    key: 'createdAt',
    label: 'Uploaded',
    headerClass: 'pr-2 whitespace-nowrap',
    cellClass: 'pr-2 text-xs whitespace-nowrap text-surface-500',
  },
];

/** Each row's edits, read once per list. */
const editsById = computed(
  () => new Map(props.items.map((asset) => [asset.id, imageEditsOf(asset.meta)])),
);
</script>

<template>
  <DataTable
    :items="items"
    :columns="COLUMNS"
    selectable
    :is-selected="isSelected"
    :row-label="(asset) => asset.name"
    table-class="min-w-[40rem]"
    @row-click="(asset, event) => emit('select', asset, event)"
    @select-all="emit('selectAll')"
    @clear="emit('clear')"
  >
    <template #cell-preview="{ item: asset }">
      <div class="h-10 w-10 overflow-hidden rounded-control bg-surface-100 dark:bg-surface-800">
        <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.alt ?? asset.name" class="h-full w-full object-cover" loading="lazy" />
        <div v-else class="flex h-full items-center justify-center text-surface-500"><Icon name="doc" class="mb-icon" /></div>
      </div>
    </template>
    <template #cell-name="{ item: asset }">
      <p class="truncate font-medium">{{ asset.name }}</p>
      <p class="truncate mb-meta">{{ asset.filename }}<span v-if="asset.alt"> - {{ asset.alt }}</span></p>
    </template>
    <template #cell-size="{ item: asset }">{{ formatBytes(asset.size) }}</template>
    <template #cell-pixels="{ item: asset }">
      <template v-if="asset.width">{{ asset.width }} x {{ asset.height }}</template>
      <span v-else class="text-surface-400">-</span>
    </template>
    <template #cell-edits="{ item: asset }">
      <span v-if="editsById.get(asset.id)?.crop" class="mb-badge mr-1"><Icon name="crop" class="mr-1 mb-icon-sm" />crop</span>
      <span v-if="editsById.get(asset.id)?.focalPoint" class="mb-badge"><Icon name="crosshair" class="mr-1 mb-icon-sm" />focal</span>
      <span v-if="!editsById.get(asset.id)?.crop && !editsById.get(asset.id)?.focalPoint" class="text-surface-400">-</span>
    </template>
    <template #cell-createdAt="{ item: asset }">{{ formatDate(asset.createdAt) }}</template>
  </DataTable>
</template>
