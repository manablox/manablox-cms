<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import type { Asset } from '@manablox/admin-sdk/features/assets/queries';
import { formatBytes, plural } from '@manablox/admin-sdk/lib/format';

/** Bulk actions for a multi-selection. */
defineProps<{
  items: readonly Asset[];
  total: number;
  allSelected: boolean;
  canDelete: boolean;
}>();
const emit = defineEmits<{ selectAll: []; clear: []; remove: [] }>();
</script>

<template>
  <aside class="mb-card mb-aside-sheet flex shrink-0 flex-col gap-4 self-start">
    <div class="flex items-start gap-2">
      <h2 class="min-w-0 flex-1 text-sm font-bold">{{ plural(items.length, 'asset') }} selected</h2>
      <IconButton icon="x" label="Clear selection" class="-mt-1 -mr-1" @click="emit('clear')" />
    </div>
    <div class="grid grid-cols-4 gap-1">
      <div
        v-for="asset in items.slice(0, 8)"
        :key="asset.id"
        class="flex aspect-square items-center justify-center overflow-hidden rounded-control bg-surface-100 text-surface-500 dark:bg-surface-800"
      >
        <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.alt ?? asset.name" class="h-full w-full object-cover" />
        <Icon v-else name="doc" class="mb-icon-lg" />
      </div>
      <div v-if="items.length > 8" class="flex aspect-square items-center justify-center rounded-control bg-surface-100 text-xs font-semibold text-surface-500 dark:bg-surface-800">
        +{{ items.length - 8 }}
      </div>
    </div>
    <p class="mb-meta">
      {{ formatBytes(items.reduce((sum, asset) => sum + asset.size, 0)) }} in total.
      Ctrl-click toggles one, Shift-click takes a run, and dragging over empty space draws a selection.
    </p>
    <div class="grid gap-2">
      <button class="mb-btn-outline" :disabled="allSelected" @click="emit('selectAll')">Select all {{ total }}</button>
      <button v-if="canDelete" type="button" class="mb-btn-ghost-danger justify-center" @click="emit('remove')">
        <Icon name="trash" /> Delete {{ plural(items.length, 'asset') }}
      </button>
    </div>
  </aside>
</template>
