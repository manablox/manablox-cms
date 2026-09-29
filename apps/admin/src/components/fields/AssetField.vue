<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import AssetPicker from '@manablox/admin-sdk/features/assets/components/AssetPicker.vue';
import {
  useAssetRelationPreview,
  useAssetsByIds,
} from '@manablox/admin-sdk/features/assets/queries';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import { useListReorder } from '~/composables/useListReorder';
import { useRelationRows } from '~/composables/useRelationRows';
import { useRelationValue } from '~/composables/useRelationValue';
import AssetDetailDialog from '~/features/assets/components/AssetDetailDialog.vue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string | string[] | null] }>();

const context = useFieldContext();
const session = useSessionStore();
const picking = ref(false);
/** The asset whose details are open in a dialog; taken from the query so edits show at once. */
const editingId = ref<string | null>(null);

const canWrite = computed(() => session.can('asset:write', context.value.spaceId));
const canDelete = computed(() => session.can('asset:delete', context.value.spaceId));

const relation = useRelationValue(
  () => props.modelValue,
  () => props.settings.multiple === true,
);
const { ids, multiple } = relation;

const { byId: assetById, rows } = useRelationRows(ids, (lookupIds) =>
  useAssetsByIds(lookupIds, () => context.value.spaceId),
);
const editing = computed(() => (editingId.value && assetById.value.get(editingId.value)) || null);

const sortable = computed(() => !context.value.readOnly && rows.value.length > 1);
function move(from: number, to: number) {
  emit('update:modelValue', relation.move(from, to));
}
const { draggingKey, dropAt, onDragStart, onDragEnd, onDragOver, onDrop } = useListReorder(
  rows,
  (id) => id,
  move,
);
/** The tile under the pointer; its left half drops before it, its right half after. */
const overTile = ref<number | null>(null);
function insertionPoint(event: DragEvent, index: number): number {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return event.clientX > rect.left + rect.width / 2 ? index + 1 : index;
}
function onTileDragOver(event: DragEvent, index: number) {
  overTile.value = index;
  onDragOver(event, insertionPoint(event, index));
}
function onTileDrop(event: DragEvent, index: number) {
  onDrop(event, insertionPoint(event, index));
  overTile.value = null;
}
function onTileDragEnd() {
  onDragEnd();
  overTile.value = null;
}
/** Which edge of a tile shows the drop marker. */
function markerAt(index: number): 'left' | 'right' | null {
  if (dropAt.value === index + 1 && overTile.value === index) return 'right';
  if (dropAt.value === index && overTile.value !== index - 1) return 'left';
  return null;
}

/** A `filter` field stores nothing; show a read-only preview of current matches. */
const isFilter = computed(
  () => props.settings.multiple === true && props.settings.selection === 'filter',
);
const { data: matches, isPending: matching } = useAssetRelationPreview(
  () => props.settings,
  isFilter,
  () => context.value.spaceId,
);

function pick(assetId: string) {
  emit('update:modelValue', relation.pick(assetId));
  if (!multiple.value) picking.value = false;
}

/** The picker's result; a single field takes the first id. */
function picked(assetIds: string[]) {
  if (!multiple.value) {
    pick(assetIds[0] as string);
    return;
  }
  emit('update:modelValue', [...ids.value, ...assetIds.filter((id) => !ids.value.includes(id))]);
  picking.value = false;
}

function clear(assetId: string) {
  emit('update:modelValue', relation.remove(assetId));
}

/** A deleted asset leaves a dangling id behind, so drop it from the field. */
function removed() {
  const assetId = editingId.value;
  editingId.value = null;
  if (assetId) clear(assetId);
}
</script>

<template>
  <div v-if="isFilter" class="space-y-2">
    <p class="mb-hint">
      Set by a filter on the content type, so it is the same on every document and always
      current. These match right now:
    </p>
    <Loader v-if="matching" inline class="px-2.5 py-2 text-sm" label="Looking..." />
    <div v-else-if="matches?.items.length" class="flex flex-wrap gap-2">
      <div
        v-for="asset in matches.items"
        :key="asset.id"
        class="aspect-video w-32 overflow-hidden rounded-card border border-surface-200 dark:border-surface-700"
      >
        <img
          v-if="asset.mimeType.startsWith('image/')"
          :src="asset.thumbnailUrl ?? asset.url ?? ''"
          :alt="asset.alt ?? asset.name"
          class="h-full w-full object-cover"
        />
        <div v-else class="flex h-full items-center justify-center p-1 text-center text-2xs">
          {{ asset.filename }}
        </div>
      </div>
    </div>
    <p v-else class="mb-hint">Nothing matches the filter yet.</p>
  </div>

  <div v-else class="space-y-2">
    <ul v-if="rows.length" class="flex flex-wrap gap-2">
      <li
        v-for="(id, index) in rows"
        :key="id"
        class="relative"
        :class="draggingKey === id ? 'opacity-40' : ''"
        :draggable="sortable"
        :data-item="index"
        @dragstart="onDragStart($event, id)"
        @dragend="onTileDragEnd"
        @dragover="onTileDragOver($event, index)"
        @drop="onTileDrop($event, index)"
      >
        <div
          v-if="markerAt(index)"
          class="pointer-events-none absolute inset-y-0 w-0.5 rounded bg-brand-500"
          :class="markerAt(index) === 'left' ? '-left-[5px]' : '-right-[5px]'"
        />
        <!-- Thumbnail rendition, cropped to 16:9. -->
        <div class="relative aspect-video w-40 overflow-hidden rounded-card border border-surface-200 dark:border-surface-700" :class="sortable ? 'cursor-grab' : ''">
          <template v-if="assetById.get(id)">
            <img
              v-if="assetById.get(id)!.mimeType.startsWith('image/')"
              :src="assetById.get(id)!.thumbnailUrl ?? assetById.get(id)!.url ?? ''"
              :alt="assetById.get(id)!.alt ?? assetById.get(id)!.name"
              class="h-full w-full object-cover"
              draggable="false"
              loading="lazy"
            />
            <div v-else class="flex h-full items-center justify-center p-1 text-center text-xs">
              {{ assetById.get(id)!.filename }}
            </div>
          </template>
          <div v-else class="flex h-full items-center justify-center"><Loader inline :label="null" /></div>
          <div v-if="sortable" class="absolute bottom-0.5 left-0.5 flex gap-0.5">
            <button type="button" class="rounded bg-black/60 p-0.5 text-white disabled:opacity-40" aria-label="Move left" title="Move left" :disabled="index === 0" @click="move(index, index - 1)">
              <Icon name="chevron" class="mb-icon-sm rotate-180" />
            </button>
            <button type="button" class="rounded bg-black/60 p-0.5 text-white disabled:opacity-40" aria-label="Move right" title="Move right" :disabled="index === rows.length - 1" @click="move(index, index + 1)">
              <Icon name="chevron" class="mb-icon-sm" />
            </button>
          </div>
          <div class="absolute top-0.5 right-0.5 flex gap-0.5">
            <button
              v-if="assetById.get(id)"
              type="button"
              class="rounded bg-black/60 p-0.5 text-white"
              :aria-label="`Edit ${assetById.get(id)!.name}`"
              @click="editingId = id"
            >
              <Icon name="settings" class="mb-icon-sm" />
            </button>
            <button
              v-if="!context.readOnly"
              type="button"
              class="rounded bg-black/60 p-0.5 text-white"
              aria-label="Remove"
              @click="clear(id)"
            >
              <Icon name="x" class="mb-icon-sm" />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <div v-if="!context.readOnly" class="flex flex-wrap gap-2">
      <button type="button" class="mb-btn-outline" @click="picking = true">
        <Icon name="image" /> {{ multiple ? 'Choose assets' : ids.length ? 'Replace' : 'Choose asset' }}
      </button>
    </div>

    <AssetDetailDialog
      v-if="editing && context.spaceId"
      :key="editing.id"
      :asset="editing"
      :space-id="context.spaceId"
      :can-write="canWrite"
      :can-delete="canDelete"
      @close="editingId = null"
      @deleted="removed()"
    />

    <AssetPicker
      v-if="picking"
      :accept="(settings.accept as string[]) ?? []"
      :multiple="multiple"
      :used="ids"
      @select="picked"
      @close="picking = false"
    />
  </div>
</template>
