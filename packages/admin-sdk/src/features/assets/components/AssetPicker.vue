<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '../../../components/Icon.vue';
import ScrollSentinel from '../../../components/ScrollSentinel.vue';
import TagFilter from '../../../components/TagFilter.vue';
import AsyncList from '../../../components/ui/AsyncList.vue';
import Dialog from '../../../components/ui/Dialog.vue';
import EmptyState from '../../../components/ui/EmptyState.vue';
import Loader from '../../../components/ui/Loader.vue';
import SearchField from '../../../components/ui/SearchField.vue';
import { useSelection } from '../../../composables/useSelection';
import { plural } from '../../../lib/format';
import { useSessionStore } from '../../../stores/session';
import { useSpaceStore } from '../../../stores/space';
import { type Asset, acceptAttribute, useAssetsPaged } from '../queries';
import { useUpload } from '../useUpload';
import AssetGrid from './AssetGrid.vue';

/**
 * Asset library dialog filtered by `accept`, scrolling through the whole library.
 * A single field uses the clicked asset at once; `multiple` selects like the Assets
 * page (click, Ctrl/Shift-click, rubber band) and confirms the whole selection.
 * Uploads always take several files at once and only the types `accept` allows; a lone
 * upload is picked for the field, a batch waits to be picked by hand.
 */
const props = defineProps<{
  accept?: string[];
  /** Pick several at a time. */
  multiple?: boolean;
  /** Ids the field already holds, marked in the grid. */
  used?: readonly string[];
}>();
const emit = defineEmits<{ select: [string[]]; close: [] }>();

const spaces = useSpaceStore();
const session = useSessionStore();
const search = ref('');
const tagIds = ref<string[]>([]);

/** The server filters by one prefix only. */
const mimePrefix = computed(() => (props.accept?.length === 1 ? (props.accept[0] ?? null) : null));
const { data, isPending, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
  useAssetsPaged(search, { mimeType: () => mimePrefix.value, tagIds });

/** Client-side prefix filter for multiple `accept` entries. */
const items = computed<Asset[]>(() => {
  const all = (data.value?.pages ?? []).flatMap((page) => page.items);
  const accept = props.accept ?? [];
  if (accept.length < 2) return all;
  return all.filter((asset) => accept.some((prefix) => asset.mimeType.startsWith(prefix)));
});
/** The server's count while pages are still coming; the filtered list once they are all in. */
const total = computed(() =>
  hasNextPage.value ? (data.value?.pages.at(-1)?.total ?? items.value.length) : items.value.length,
);

const canWrite = computed(() => session.can('asset:write', spaces.currentId));
const acceptLabel = computed(() => {
  const accept = props.accept ?? [];
  if (!accept.length) return null;
  return accept.map((prefix) => prefix.replace(/\/$/, '').replace('image', 'images')).join(', ');
});

const usedIds = computed(() => new Set(props.used ?? []));

// --- selection ---------------------------------------------------------------------

const scroller = ref<HTMLElement | null>(null);
const selection = useSelection({
  items,
  keyOf: (asset: Asset) => asset.id,
  container: scroller,
  noun: 'asset',
});

/** A single field takes the clicked asset right away. */
function onSelect(asset: Asset, event: MouseEvent) {
  if (!props.multiple) {
    emit('select', [asset.id]);
    return;
  }
  selection.select(asset.id, event);
}

function confirm() {
  if (!selection.size.value) return;
  emit(
    'select',
    selection.selectedItems.value.map((asset) => asset.id),
  );
}

const upload = useUpload({
  spaceId: () => spaces.currentId,
  enabled: canWrite,
  accept: () => props.accept,
  // A lone upload is taken right away; a batch is only added to the library, picked by hand.
  onDone: (ids) => {
    const only = ids.length === 1 ? ids[0] : null;
    if (!only) return;
    if (props.multiple) selection.selected.value = new Set([...selection.selected.value, only]);
    else emit('select', [only]);
  },
});

const uploadLabel = computed(() => {
  const progress = upload.progress.value;
  if (!progress) return 'Upload new';
  return progress.total > 1
    ? `Uploading ${progress.done + 1}/${progress.total}...`
    : 'Uploading...';
});
</script>

<template>
  <Dialog :title="multiple ? 'Choose assets' : 'Choose an asset'" width="max-w-5xl" dismissable @close="emit('close')">
    <div class="mb-3 flex flex-wrap items-center gap-3">
      <!-- The dialog opens to search. -->
      <SearchField v-model="search" label="Search assets" autofocus class="flex-1 sm:max-w-xs" placeholder="Search by name or tag..." />
      <TagFilter v-model="tagIds" />
      <p v-if="acceptLabel" class="mb-meta">Showing {{ acceptLabel }}</p>
      <div class="flex-1" />
      <label v-if="canWrite" class="mb-btn-outline cursor-pointer">
        <Icon name="upload" />
        {{ uploadLabel }}
        <input type="file" class="sr-only" multiple :accept="acceptAttribute(accept)" :disabled="upload.busy.value" @change="upload.onPick" />
      </label>
    </div>

    <p class="mb-hint mb-2">
      <template v-if="multiple">
        Click to select, Ctrl-click to add one, Shift-click for a range, or drag a rectangle over
        the tiles.
      </template>
      <template v-else>Click an asset to use it.</template>
    </p>

    <div
      class="relative rounded-card border transition"
      :class="upload.dragging.value
        ? 'border-brand-500 bg-brand-50 ring-3 ring-brand-500/20 dark:bg-brand-600/10'
        : 'border-transparent'"
      @dragenter.prevent="upload.onDragOver"
      @dragover.prevent="upload.onDragOver"
      @dragleave.self="upload.dragging.value = false"
      @drop.prevent="upload.onDrop"
    >
      <div v-if="upload.dragging.value" class="pointer-events-none mb-z-local absolute inset-0 flex items-center justify-center text-sm font-semibold text-brand-700 dark:text-brand-100">
        {{ multiple ? 'Drop to upload and select' : 'Drop to upload and use it' }}
      </div>

      <!-- The band needs its own scroll container, in whose content coordinates it is drawn. -->
      <div
        ref="scroller"
        class="relative h-[min(62vh,40rem)] overflow-auto"
        :class="selection.band.value ? 'select-none' : ''"
        @pointerdown="multiple ? selection.onBandStart($event) : undefined"
      >
        <div
          v-if="selection.band.value"
          class="mb-z-local pointer-events-none absolute rounded-sm border border-brand-500 bg-brand-500/15"
          :style="selection.bandStyle.value"
          aria-hidden="true"
        />

        <AsyncList :pending="isPending" :error="error" :retry="refetch" :items="items" skeleton="grid" :rows="12">
          <template #empty>
            <EmptyState
              class="h-full"
              icon="image"
              :title="search ? `Nothing named '${search}'` : 'Nothing to pick yet'"
              :description="canWrite ? 'Drop files here or use Upload new; a single file is picked as soon as it lands.' : 'Someone with upload rights can add files in Assets.'"
            />
          </template>
          <AssetGrid
            dense
            :items="items"
            :is-selected="selection.isSelected"
            :is-used="(id) => usedIds.has(id)"
            @select="onSelect"
          />
          <Loader v-if="isFetchingNextPage" inline class="px-2.5 py-2 text-sm" label="Loading more..." />
          <ScrollSentinel :disabled="!hasNextPage || isFetchingNextPage" @reach="fetchNextPage()" />
        </AsyncList>
      </div>
    </div>

    <template #footer="{ close }">
      <p class="mr-auto mb-meta tabular-nums">
        {{ plural(items.length, 'asset') }}<span v-if="items.length < total"> of {{ total }}</span>
        <span v-if="multiple && selection.size.value">
          - {{ selection.size.value }} selected
        </span>
      </p>
      <button
        v-if="multiple && items.length"
        type="button"
        class="mb-btn-ghost"
        @click="selection.size.value === items.length ? selection.clear() : selection.selectAll()"
      >
        {{ selection.size.value === items.length ? 'Clear' : 'Select all' }}
      </button>
      <button type="button" class="mb-btn-ghost" @click="close">Cancel</button>
      <button
        v-if="multiple"
        type="button"
        class="mb-btn-primary"
        :disabled="!selection.size.value"
        @click="confirm"
      >
        Add {{ plural(selection.size.value, 'asset') }}
      </button>
    </template>
  </Dialog>
</template>
