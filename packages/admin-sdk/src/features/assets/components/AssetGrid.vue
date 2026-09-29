<script setup lang="ts">
import Icon from '../../../components/Icon.vue';
import { formatBytes } from '../../../lib/format';
import type { Asset } from '../queries';

/** The library as fixed-width tiles, so the detail panel removes columns. `data-id` serves the rubber band. */
defineProps<{
  items: readonly Asset[];
  isSelected: (id: string) => boolean;
  /** Marks tiles the field already holds; only the picker passes it. */
  isUsed?: (id: string) => boolean;
  /** Smaller tiles, so the picker dialog shows more at once. */
  dense?: boolean;
}>();
const emit = defineEmits<{ select: [asset: Asset, event: MouseEvent] }>();
</script>

<template>
  <div
    class="grid min-h-full content-start justify-start gap-3 pb-6"
    :class="dense ? 'grid-cols-[repeat(auto-fill,7.5rem)]' : 'grid-cols-[repeat(auto-fill,10rem)]'"
  >
    <button
      v-for="asset in items"
      :key="asset.id"
      :data-id="asset.id"
      class="group overflow-hidden rounded-card border bg-surface-0 text-left transition dark:bg-surface-900"
      :class="isSelected(asset.id)
        ? 'border-brand-500 ring-3 ring-brand-500/25'
        : 'border-surface-200 hover:border-surface-400 dark:border-surface-800 dark:hover:border-surface-600'"
      :aria-pressed="isSelected(asset.id)"
      @click="emit('select', asset, $event)"
    >
      <div class="relative aspect-square bg-surface-100 dark:bg-surface-800">
        <img v-if="asset.thumbnailUrl" :src="asset.thumbnailUrl" :alt="asset.alt ?? asset.name" class="h-full w-full object-cover" loading="lazy" />
        <div v-else class="flex h-full flex-col items-center justify-center gap-1 text-surface-500">
          <Icon name="doc" class="h-7 w-7" />
          <span class="font-mono text-2xs uppercase">{{ asset.mimeType.split('/')[1] }}</span>
        </div>
        <span v-if="isSelected(asset.id)" class="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-pill bg-brand-600 text-white">
          <Icon name="check" class="mb-icon-sm" />
        </span>
        <span v-if="isUsed?.(asset.id)" class="absolute bottom-1.5 left-1.5 rounded-pill bg-surface-900/75 px-1.5 py-0.5 text-2xs font-semibold text-white">
          In field
        </span>
      </div>
      <div class="px-2 py-1.5">
        <p class="truncate text-xs font-medium">{{ asset.name }}</p>
        <p class="truncate text-2xs text-surface-500">{{ formatBytes(asset.size) }}<span v-if="asset.width"> - {{ asset.width }}x{{ asset.height }}</span></p>
      </div>
    </button>
  </div>
</template>
