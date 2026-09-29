<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { moveInList } from '@manablox/admin-sdk/lib/collections';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { focusFirstFieldSoon } from '@manablox/admin-sdk/lib/focus';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import DropLine from '~/components/DropLine.vue';
import { useListReorder } from '~/composables/useListReorder';
import FieldGrid from '~/features/content/components/FieldGrid.vue';
import type { FieldInputProps } from '~/lib/field-input';
import { completeSubFields, itemsOf, newItem, type RepeaterItem } from '~/lib/sub-fields';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [RepeaterItem[]] }>();

const context = useFieldContext();
const readOnly = computed(() => context.value.readOnly);
const items = computed(() => itemsOf(props.modelValue));
const subFields = computed(() =>
  completeSubFields(props.settings).sort((a, b) => a.admin.position - b.admin.position),
);
/** Per-item copies with unique ids, so each item's labels point at its own inputs. */
function fieldsOf(item: RepeaterItem) {
  return subFields.value.map((field) => ({ ...field, id: `${item.itemId}-${field.id}` }));
}
const min = computed(() => (typeof props.settings.min === 'number' ? props.settings.min : 0));
const max = computed(() => (typeof props.settings.max === 'number' ? props.settings.max : null));
const canAdd = computed(() => max.value === null || items.value.length < max.value);
const canRemove = computed(() => items.value.length > min.value);

const open = ref<Set<string>>(new Set());
const root = useTemplateRef<HTMLElement>('root');

// Mutations replace the array so dirty tracking and undo stay reliable.
function add() {
  const item = newItem();
  emit('update:modelValue', [...items.value, item]);
  open.value = new Set(open.value).add(item.itemId);
  void nextTick(() => {
    const panel = root.value?.querySelector<HTMLElement>(`[data-item-panel="${item.itemId}"]`);
    if (panel) focusFirstFieldSoon(panel);
    panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function remove(itemId: string) {
  emit(
    'update:modelValue',
    items.value.filter((item) => item.itemId !== itemId),
  );
}

function update(itemId: string, name: string, value: unknown) {
  emit(
    'update:modelValue',
    items.value.map((item) =>
      item.itemId === itemId ? { ...item, fields: { ...item.fields, [name]: value } } : item,
    ),
  );
}

function move(from: number, to: number) {
  const next = moveInList(items.value, from, to);
  if (next !== items.value) emit('update:modelValue', [...next]);
}

const { draggingKey, dropAt, onDragStart, onDragEnd, onDragOver, onDrop } = useListReorder(
  () => items.value,
  (item) => item.itemId,
  move,
);

/** The server's path for an item's fields carries its index. */
function invalid(index: number): boolean {
  return context.value.errorUnder([...props.path, index]);
}
/** Invalid items open themselves, so the bad field is on screen. */
function isOpen(itemId: string, index: number): boolean {
  return open.value.has(itemId) || invalid(index);
}

function toggle(itemId: string) {
  const next = new Set(open.value);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  open.value = next;
}

const allOpen = computed(
  () => items.value.length > 0 && items.value.every((item) => open.value.has(item.itemId)),
);
function toggleAll() {
  open.value = allOpen.value ? new Set() : new Set(items.value.map((item) => item.itemId));
}

/** Collapsed label: the first filled summary field. */
function summary(item: RepeaterItem): string {
  for (const field of subFields.value) {
    if (!context.value.fieldTypeMeta(field.type)?.admin.summary) continue;
    const value = item.fields[field.name];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
}
</script>

<template>
  <div ref="root" class="space-y-2">
    <p v-if="!subFields.length" class="mb-hint">This repeater has no fields yet. Add some in its content type.</p>

    <template v-else>
      <ul v-if="items.length">
        <li v-for="(item, index) in items" :key="item.itemId">
          <!-- The gap between items is the drop target. -->
          <DropLine :active="dropAt === index" @dragover="onDragOver($event, index)" @drop="onDrop($event, index)" />

          <div
            class="overflow-hidden rounded-card border border-surface-200 dark:border-surface-700"
            :class="[
              draggingKey === item.itemId ? 'opacity-40' : '',
              invalid(index) ? 'mb-invalid border-danger-400 dark:border-danger-500' : '',
            ]"
            :data-invalid="invalid(index) ? '' : undefined"
            :data-item="index"
          >
            <!-- Header-only drag source keeps text in open items selectable. -->
            <div
              class="flex items-center gap-2 mb-surface-inset px-2.5 py-1.5"
              :draggable="!readOnly"
              @dragstart="onDragStart($event, item.itemId)"
              @dragend="onDragEnd"
            >
              <Icon v-if="!readOnly" name="drag" class="mb-icon-sm shrink-0 cursor-grab text-surface-400" aria-hidden="true" />
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                :aria-expanded="isOpen(item.itemId, index)"
                @click="toggle(item.itemId)"
              >
                <Icon :name="isOpen(item.itemId, index) ? 'down' : 'chevron'" class="mb-icon-sm shrink-0" />
                <span class="shrink-0 font-medium tabular-nums">{{ index + 1 }}</span>
                <span class="truncate mb-meta">{{ summary(item) }}</span>
                <Icon
                  v-if="invalid(index)"
                  name="alert"
                  class="mb-icon-sm shrink-0 text-danger-600 dark:text-danger-400"
                  role="img"
                  aria-label="Has errors"
                />
              </button>
              <template v-if="!readOnly">
                <IconButton icon="up" label="Move up" :disabled="index === 0" @click="move(index, index - 1)" />
                <IconButton icon="down" label="Move down" :disabled="index === items.length - 1" @click="move(index, index + 1)" />
                <IconButton
                  icon="trash"
                  label="Remove item"
                  :title="canRemove ? 'Remove item' : `Keep at least ${min}`"
                  danger
                  :disabled="!canRemove"
                  @click="remove(item.itemId)"
                />
              </template>
            </div>

            <div v-if="isOpen(item.itemId, index)" :data-item-panel="item.itemId" class="border-t border-surface-200 p-3 dark:border-surface-700">
              <FieldGrid
                :fields="fieldsOf(item)"
                :values="item.fields"
                :path="[...path, index]"
                @update="(name, value) => update(item.itemId, name, value)"
              />
            </div>
          </div>
        </li>

        <!-- Trailing drop target. -->
        <li>
          <DropLine :active="dropAt === items.length" @dragover="onDragOver($event, items.length)" @drop="onDrop($event, items.length)" />
        </li>
      </ul>
      <p v-else-if="readOnly" class="mb-hint">No items.</p>

      <div v-if="!readOnly || items.length > 1" class="flex flex-wrap items-center gap-3">
        <button
          v-if="!readOnly"
          type="button"
          class="mb-btn-outline border-dashed"
          :disabled="!canAdd"
          :title="canAdd ? undefined : `At most ${max}`"
          @click="add"
        >
          <Icon name="plus" /> Add item
        </button>
        <span v-if="!readOnly && (min > 0 || max !== null)" class="mb-hint">
          <template v-if="min > 0 && max !== null">{{ min }} to {{ max }} items</template>
          <template v-else-if="min > 0">At least {{ min }} {{ min === 1 ? 'item' : 'items' }}</template>
          <template v-else>Up to {{ max }} {{ max === 1 ? 'item' : 'items' }}</template>
        </span>
        <button v-if="items.length > 1" type="button" class="mb-btn-ghost mb-btn-sm ml-auto" @click="toggleAll">
          <Icon :name="allOpen ? 'up' : 'down'" class="mb-icon-sm" />
          {{ allOpen ? 'Collapse all' : 'Expand all' }}
        </button>
      </div>
    </template>
  </div>
</template>
