<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import DropLine from '~/components/DropLine.vue';
import {
  clearDrag,
  draggingItem,
  draggingKey,
  dropZone,
  type EditorItem,
  type MenuOp,
} from '~/features/menus/model';

/**
 * One level of the menu tree; edits bubble to the page. Dropping on the strip above a row
 * reorders, on the row nests; arrow buttons do the same for keyboard and touch.
 */
const props = defineProps<{
  items: EditorItem[];
  depth: number;
  /** The entry these are the children of; `null` at the top level. */
  parentKey: string | null;
  readOnly: boolean;
  errorFor: (key: string) => string | null;
  /** Keys with an open details panel, shared across levels. */
  open: Set<string>;
}>();
const emit = defineEmits<{ op: [op: MenuOp]; toggle: [key: string] }>();

const spaces = useSpaceStore();

const TARGETS = [
  { value: '_self', label: 'The same tab' },
  { value: '_blank', label: 'A new tab' },
] as const;

const isOpen = (item: EditorItem) => props.open.has(item.key) || props.errorFor(item.key) !== null;

// --- dragging -----------------------------------------------------------------

function onDragStart(event: DragEvent, item: EditorItem) {
  if (props.readOnly) return;
  draggingKey.value = item.key;
  draggingItem.value = item;
  event.dataTransfer?.setData('text/plain', item.key);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

/** Whether `key` is `item` or somewhere below it. */
function contains(item: { key: string; children: unknown[] }, key: string): boolean {
  return (
    item.key === key ||
    (item.children as { key: string; children: unknown[] }[]).some((child) => contains(child, key))
  );
}

/** Any row but the dragged entry or its descendants is a valid target. */
function allowed(target: EditorItem | null): boolean {
  const dragged = draggingItem.value;
  if (props.readOnly || !dragged) return false;
  if (target) return !contains(dragged, target.key);
  return props.parentKey === null || !contains(dragged, props.parentKey);
}

function onDragOver(
  event: DragEvent,
  target: EditorItem | null,
  mode: 'before' | 'into' | 'after',
) {
  if (!allowed(target)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropZone.value = { key: target?.key ?? props.parentKey ?? '', mode };
}

function onDragLeave(target: EditorItem | null, mode: 'before' | 'into' | 'after') {
  const zone = dropZone.value;
  if (zone && zone.key === (target?.key ?? props.parentKey ?? '') && zone.mode === mode) {
    dropZone.value = null;
  }
}

function onDrop(event: DragEvent, target: EditorItem | null, mode: 'before' | 'into' | 'after') {
  if (!allowed(target)) return;
  event.preventDefault();
  event.stopPropagation();
  const key = draggingKey.value as string;
  clearDrag();

  if (mode === 'into' && target) {
    emit('op', { kind: 'drop', key, parentKey: target.key, index: target.children.length });
    return;
  }
  const index =
    mode === 'before' && target
      ? props.items.findIndex((candidate) => candidate.key === target.key)
      : props.items.length;
  emit('op', { kind: 'drop', key, parentKey: props.parentKey, index: Math.max(0, index) });
}

const zoneActive = (key: string, mode: 'before' | 'into' | 'after') =>
  dropZone.value?.key === key && dropZone.value?.mode === mode;
</script>

<template>
  <ol :class="depth ? 'ml-5 border-l-2 border-surface-200 pl-3 sm:ml-7 dark:border-surface-800' : ''">
    <li v-for="(item, index) in items" :key="item.key">
      <DropLine
        :active="zoneActive(item.key, 'before')"
        @dragover="onDragOver($event, item, 'before')"
        @dragleave="onDragLeave(item, 'before')"
        @drop="onDrop($event, item, 'before')"
      />

      <div
        class="overflow-hidden rounded-card border bg-surface-0 transition dark:bg-surface-900"
        :class="[
          errorFor(item.key)
            ? 'border-danger-400 dark:border-danger-500'
            : zoneActive(item.key, 'into')
              ? 'border-brand-500 ring-2 ring-brand-500/30'
              : 'border-surface-200 dark:border-surface-700',
          draggingKey === item.key ? 'opacity-40' : '',
        ]"
        @dragover="onDragOver($event, item, 'into')"
        @dragleave="onDragLeave(item, 'into')"
        @drop="onDrop($event, item, 'into')"
      >
        <!-- Only the header drags, so panel text stays selectable. -->
        <div
          class="flex items-center gap-2 mb-surface-inset px-2.5 py-2"
          :draggable="!readOnly"
          @dragstart="onDragStart($event, item)"
          @dragend="clearDrag"
        >
          <Icon
            v-if="!readOnly"
            name="drag"
            class="mb-icon-sm shrink-0 cursor-grab text-surface-400"
            aria-hidden="true"
          />
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
            :aria-expanded="isOpen(item)"
            @click="emit('toggle', item.key)"
          >
            <Icon :name="isOpen(item) ? 'down' : 'chevron'" class="mb-icon-sm shrink-0" />
            <Icon
              :name="item.localizationId ? typeIcon(spaces.typeById(item.content?.typeId ?? '')) : 'external'"
              class="mb-icon-sm shrink-0"
              :class="item.localizationId ? 'text-brand-500' : 'text-warn-500'"
            />
            <template v-if="item.localizationId">
              <span class="truncate font-medium">{{ item.label || item.content?.title || 'Not available in this language' }}</span>
              <span v-if="item.content && item.content.status !== 'published'" class="mb-badge-warn shrink-0 text-2xs">{{ item.content.status }}</span>
              <span class="hidden truncate font-mono mb-meta sm:inline">
                {{ item.content?.permalink != null ? `/${item.content.permalink}` : item.content ? 'no permalink' : 'no translation' }}
              </span>
            </template>
            <template v-else>
              <span class="truncate font-medium" :class="item.label ? '' : 'text-surface-500'">{{ item.label || 'Untitled link' }}</span>
              <span v-if="item.target === '_blank'" class="mb-badge shrink-0 text-2xs" title="Opens in a new tab">new tab</span>
              <span class="hidden truncate font-mono text-xs sm:inline" :class="item.url ? 'text-surface-500' : 'text-warn-600 dark:text-warn-400'">{{ item.url || 'no address yet' }}</span>
            </template>
            <span v-if="item.children.length" class="mb-badge shrink-0" :title="`${item.children.length} nested`">{{ item.children.length }}</span>
          </button>

          <template v-if="!readOnly">
            <button type="button" aria-label="Move up" title="Move up" :disabled="index === 0" @click="emit('op', { kind: 'move', key: item.key, by: -1 })">
              <Icon name="undo" class="mb-icon-sm rotate-90" />
            </button>
            <button type="button" aria-label="Move down" title="Move down" :disabled="index === items.length - 1" @click="emit('op', { kind: 'move', key: item.key, by: 1 })">
              <Icon name="redo" class="mb-icon-sm rotate-90" />
            </button>
            <button type="button" aria-label="Move out one level" title="Move out one level" :disabled="parentKey === null" @click="emit('op', { kind: 'outdent', key: item.key })">
              <Icon name="chevron" class="mb-icon-sm rotate-180" />
            </button>
            <button type="button" aria-label="Nest under the entry above" title="Nest under the entry above" :disabled="index === 0" @click="emit('op', { kind: 'indent', key: item.key })">
              <Icon name="chevron" class="mb-icon-sm" />
            </button>
            <IconButton icon="trash" label="Remove entry" danger @click="emit('op', { kind: 'remove', key: item.key })" />
          </template>
        </div>

        <div v-if="isOpen(item)" class="border-t border-surface-200 p-3 dark:border-surface-700">
          <div class="grid gap-3" :class="item.localizationId ? '' : 'sm:grid-cols-2'">
            <TextField
              label="Label"
              :model-value="item.label"
              :placeholder="item.content?.title ?? (item.localizationId ? 'The title of the document' : 'Read the blog')"
              :readonly="readOnly"
              :hint="item.localizationId ? 'Leave empty to use the document\'s title.' : undefined"
              @update:model-value="emit('op', { kind: 'update', key: item.key, patch: { label: String($event ?? '') } })"
            />
            <TextField
              v-if="!item.localizationId"
              label="Address"
              :model-value="item.url"
              class="mb-input-mono"
              placeholder="https://... or /path"
              :readonly="readOnly"
              @update:model-value="emit('op', { kind: 'update', key: item.key, patch: { url: String($event ?? '') } })"
            />
            <!-- The value is the HTML `target` attribute, delivered as is. -->
            <FormField v-if="!item.localizationId" label="Opens in" v-slot="{ id }">
              <Select
                :id="id"
                :model-value="item.target"
                :options="TARGETS"
                :disabled="readOnly"
                @update:model-value="emit('op', { kind: 'update', key: item.key, patch: { target: $event } })"
              />
            </FormField>
          </div>
          <p v-if="errorFor(item.key)" class="mb-error">{{ errorFor(item.key) }}</p>
        </div>
      </div>

      <MenuItemTree
        v-if="item.children.length"
        :items="item.children"
        :depth="depth + 1"
        :parent-key="item.key"
        :read-only="readOnly"
        :error-for="errorFor"
        :open="open"
        @op="emit('op', $event)"
        @toggle="emit('toggle', $event)"
      />
    </li>

    <!-- Drop slot after the last row. -->
    <li v-if="items.length">
      <DropLine
        :active="zoneActive(parentKey ?? '', 'after')"
        @dragover="onDragOver($event, null, 'after')"
        @dragleave="onDragLeave(null, 'after')"
        @drop="onDrop($event, null, 'after')"
      />
    </li>
  </ol>
</template>
