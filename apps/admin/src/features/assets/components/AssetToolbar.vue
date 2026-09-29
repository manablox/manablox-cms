<script setup lang="ts">
import TagFilter from '@manablox/admin-sdk/components/TagFilter.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import { plural } from '@manablox/admin-sdk/lib/format';

export type AssetKind = 'all' | 'image' | 'file';
export type AssetView = 'grid' | 'table';

/** The library's filters, view toggle and count. */
defineProps<{ count: number; total: number }>();
const kind = defineModel<AssetKind>('kind', { required: true });
const search = defineModel<string>('search', { required: true });
const view = defineModel<AssetView>('view', { required: true });
const tagIds = defineModel<string[]>('tagIds', { required: true });

const KINDS: { value: AssetKind; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: 'blocks' },
  { value: 'image', label: 'Images', icon: 'image' },
  { value: 'file', label: 'Other files', icon: 'doc' },
];
const VIEWS: { value: AssetView; label: string; icon: string }[] = [
  { value: 'grid', label: 'Tiles', icon: 'grid' },
  { value: 'table', label: 'Table', icon: 'list' },
];
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <SegmentedControl v-model="kind" :options="KINDS" aria-label="Kind" />
    <SearchField v-model="search" label="Search assets" shortcut="Search assets" class="flex-1 sm:max-w-xs" placeholder="Search by name or tag..." />
    <TagFilter v-model="tagIds" />
    <div class="flex-1" />
    <p class="mb-meta tabular-nums">
      {{ plural(count, 'asset') }}
      <span v-if="total > count"> of {{ total }}</span>
    </p>
    <SegmentedControl v-model="view" :options="VIEWS" aria-label="View" icon-only />
  </div>
</template>
