<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import ScrollSentinel from '@manablox/admin-sdk/components/ScrollSentinel.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import { useSelection } from '@manablox/admin-sdk/composables/useSelection';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import AssetGrid from '@manablox/admin-sdk/features/assets/components/AssetGrid.vue';
import {
  acceptAttribute,
  assets,
  useAssetLimits,
  useAssetsPaged,
} from '@manablox/admin-sdk/features/assets/queries';
import { useUpload } from '@manablox/admin-sdk/features/assets/useUpload';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { useLocalStorage } from '@vueuse/core';
import { computed, ref } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import AssetBulkPanel from '~/features/assets/components/AssetBulkPanel.vue';
import AssetDetailPanel from '~/features/assets/components/AssetDetailPanel.vue';
import AssetTable from '~/features/assets/components/AssetTable.vue';
import AssetToolbar, {
  type AssetKind,
  type AssetView,
} from '~/features/assets/components/AssetToolbar.vue';

/** The asset library. Selection is `useSelection`, upload is `useUpload`. */
const spaces = useSpaceStore();

const search = ref('');
const kind = ref<AssetKind>('all');
const tagIds = ref<string[]>([]);
/** Tiles or a table; remembered per browser. */
const view = useLocalStorage<AssetView>('manablox.assets.view', 'grid');

// "Other files" is everything but images; more pages load as the grid scrolls.
const { data, isPending, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
  useAssetsPaged(search, {
    mimeType: () => (kind.value === 'image' ? 'image/' : null),
    mimeTypeNot: () => (kind.value === 'file' ? ['image/'] : []),
    tagIds,
  });
const items = computed(() => (data.value?.pages ?? []).flatMap((page) => page.items));
const total = computed(() => data.value?.pages.at(-1)?.total ?? items.value.length);

const canWrite = useCan('asset:write');
const canDelete = useCan('asset:delete');

// The space's limits filter the file picker.
const { data: limits } = useAssetLimits();
const accept = computed(() =>
  acceptAttribute(limits.value?.effective.allowedMimeTypes ?? undefined),
);
const maxMb = computed(() =>
  limits.value ? Math.round((limits.value.effective.maxFileSize / 1024 / 1024) * 10) / 10 : null,
);

// --- selection ---------------------------------------------------------------------

const scroller = ref<HTMLElement | null>(null);
const selection = useSelection({
  items,
  keyOf: (asset) => asset.id,
  container: scroller,
  noun: 'asset',
});
const detail = computed(
  () => items.value.find((asset) => asset.id === selection.only.value) ?? null,
);

/** A bulk delete where some assets stayed. */
class PartialDelete extends Error {}

function removeSelected() {
  const list = selection.selectedItems.value;
  const spaceId = spaces.currentId;
  if (!list.length || !spaceId) return;
  return confirmAndRun(
    {
      title: `Delete ${list.length} assets?`,
      message:
        'The originals and every generated variant are removed from storage. An asset another space also holds only leaves this one. Documents that use them keep dangling references.',
      confirmLabel: `Delete ${list.length} assets`,
      danger: true,
    },
    async () => {
      let failed = 0;
      for (const asset of list) {
        await assets.remove(spaceId, asset.id, asset.spaceIds).catch(() => {
          failed += 1;
        });
      }
      selection.clear();
      if (failed)
        throw new PartialDelete(`${failed} of ${list.length} assets could not be deleted`);
    },
    {
      success: `Deleted ${list.length} assets`,
      describe: (error) => (error instanceof PartialDelete ? error.message : messageFor(error)),
    },
  );
}

/** A file a plugin created is already stored; refresh and select it. */
function onAdded(id: string) {
  invalidate.assets(spaces.currentId);
  selection.only.value = id;
}

// --- upload ------------------------------------------------------------------------

const upload = useUpload({
  spaceId: () => spaces.currentId,
  enabled: canWrite,
  // Select the new upload.
  onUploaded: (id) => {
    selection.only.value = id;
  },
});

/* The upload key clicks the hidden file input, since only a click opens it. */
const filePicker = ref<HTMLInputElement | null>(null);
useShortcuts(() => [
  {
    keys: 'u',
    label: 'Upload files',
    enabled: () => canWrite.value && !upload.busy.value,
    run: () => filePicker.value?.click(),
  },
  {
    keys: 'Delete',
    label: 'Delete the selected assets',
    enabled: () => canDelete.value && selection.size.value > 0,
    run: () => void removeSelected(),
  },
  {
    keys: 'Backspace',
    label: 'Delete the selected assets',
    hidden: true,
    enabled: () => canDelete.value && selection.size.value > 0,
    run: () => void removeSelected(),
  },
]);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8">
      <PageHeader title="Assets" description="Images and files for this space, served resized through the media endpoint.">
        <label v-if="canWrite" class="mb-btn-primary cursor-pointer" :title="shortcutHint('u', 'Upload files')">
          <Icon name="upload" />
          {{ upload.progress.value ? `Uploading ${upload.progress.value.done + 1} of ${upload.progress.value.total}...` : 'Upload files' }}
          <input ref="filePicker" type="file" multiple class="sr-only" :accept="accept" :disabled="upload.busy.value" @change="upload.onPick" />
        </label>
        <PluginSlot id="assets.actions" :props="{ selection: selection.selectedItems.value, added: onAdded }" />
      </PageHeader>

      <AssetToolbar v-model:kind="kind" v-model:search="search" v-model:view="view" v-model:tag-ids="tagIds" class="mb-4" :count="items.length" :total="total" />
      <p v-if="upload.refused.value" class="mb-callout mb-4" role="alert">{{ upload.refused.value }}</p>
    </div>

    <div class="flex min-h-0 flex-1 gap-6 px-4 pb-4 sm:px-6 sm:pb-6 lg:px-8 lg:pb-8">
      <!-- Drop target. -->
      <div
        ref="scroller"
        class="relative min-h-0 flex-1 overflow-auto rounded-card border transition"
        :class="[
          upload.dragging.value
            ? 'border-brand-500 bg-brand-50 ring-3 ring-brand-500/20 dark:bg-brand-600/10'
            : 'border-transparent',
          selection.band.value ? 'select-none' : '',
        ]"
        @dragenter.prevent="upload.onDragOver"
        @dragover.prevent="upload.onDragOver"
        @dragleave.self="upload.dragging.value = false"
        @drop.prevent="upload.onDrop"
        @pointerdown="selection.onBandStart"
      >
        <!-- Selection rectangle, in content coordinates. -->
        <div
          v-if="selection.band.value"
          class="mb-z-local pointer-events-none absolute rounded-sm border border-brand-500 bg-brand-500/15"
          :style="selection.bandStyle.value"
          aria-hidden="true"
        />
        <div
          v-if="upload.dragging.value"
          class="mb-z-local pointer-events-none absolute inset-0 flex items-center justify-center text-sm font-semibold text-brand-700 dark:text-brand-100"
        >
          Drop to upload
        </div>

        <AsyncList
          :pending="isPending"
          :error="error"
          :retry="refetch"
          :items="items"
          :skeleton="view === 'grid' ? 'grid' : 'table'"
          :rows="10"
        >
          <template #empty>
            <EmptyState
              fill
              :icon="kind === 'file' ? 'doc' : 'image'"
              :title="search ? `Nothing named '${search}'` : kind === 'all' ? 'No assets yet' : `No ${kind === 'image' ? 'images' : 'other files'} yet`"
              :description="search
                ? 'Try another name, or clear the search.'
                : canWrite
                  ? `Drop files here, or use Upload files above. Images get resized variants automatically.${maxMb ? ` Up to ${maxMb} MB each.` : ''}`
                  : 'Someone with upload rights can add files here.'"
            />
          </template>
          <AssetGrid
            v-if="view === 'grid'"
            :items="items"
            :is-selected="selection.isSelected"
            @select="(asset, event) => selection.select(asset.id, event)"
          />
          <AssetTable
            v-else
            :items="items"
            :is-selected="selection.isSelected"
            @select="(asset, event) => selection.select(asset.id, event)"
            @select-all="selection.selectAll"
            @clear="selection.clear"
          />
          <Loader v-if="isFetchingNextPage" inline class="px-2.5 py-2 text-sm" label="Loading more..." />
          <ScrollSentinel :disabled="!hasNextPage || isFetchingNextPage" @reach="fetchNextPage()" />
        </AsyncList>
      </div>

      <AssetBulkPanel
        v-if="selection.size.value > 1"
        :items="selection.selectedItems.value"
        :total="items.length"
        :all-selected="selection.allSelected.value"
        :can-delete="canDelete"
        @select-all="selection.selectAll"
        @clear="selection.clear"
        @remove="removeSelected"
      />
      <AssetDetailPanel
        v-else-if="detail && spaces.currentId"
        :key="detail.id"
        :asset="detail"
        :space-id="spaces.currentId"
        :can-write="canWrite"
        :can-delete="canDelete"
        @close="selection.only.value = null"
        @deleted="selection.only.value = null"
      />
    </div>
  </div>
</template>