<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Kbd from '@manablox/admin-sdk/components/ui/Kbd.vue';
import { type ErrorFor, scoped } from '@manablox/admin-sdk/composables/useDraftForm';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import type {
  FieldDefinition,
  FieldTypeMeta,
} from '@manablox/admin-sdk/features/content-types/queries';
import { firstField } from '@manablox/admin-sdk/lib/focus';
import { digitFor, indexForDigit, shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import DropLine from '~/components/DropLine.vue';
import { useListReorder } from '~/composables/useListReorder';
import FieldSettings from '~/features/content-types/components/FieldSettings.vue';
import { type ErrorUnder, scopedUnder } from '~/features/content-types/model';

/**
 * The type builder's field list, also a repeater's sub-field list when `nested`.
 * Alt+N opens the type menu anywhere (top level only); digits 1-9 and 0 pick a type.
 */
const props = defineProps<{
  fields: FieldDefinition[];
  fieldTypes: FieldTypeMeta[];
  readOnly: boolean;
  /** The saved versions of these fields; their names are locked. */
  saved: readonly FieldDefinition[];
  /** Resolves `['fields', index, ...]`. */
  errorFor: ErrorFor;
  errorUnder?: ErrorUnder | undefined;
  /** Positions of fields with errors; derived from `errorUnder` when absent. */
  errored?: ReadonlySet<number>;
  nested?: boolean;
  /** Id stem of the owning field's inputs. */
  idBase?: string;
  depth?: number;
}>();
const emit = defineEmits<{
  add: [typeName: string];
  remove: [id: string];
  move: [from: number, to: number];
  update: [index: number, field: FieldDefinition];
}>();

const showAdd = ref(false);
const openField = ref<string | null>(null);

const savedById = computed(() => new Map(props.saved.map((field) => [field.id, field])));
function hasErrors(index: number): boolean {
  return props.errored?.has(index) ?? props.errorUnder?.(['fields', index]) ?? false;
}
function settingsIndex(index: number): number | string {
  return props.idBase === undefined ? index : `${props.idBase}-${index}`;
}

// A nested list opens its first erroring field, as the page does for top-level ones.
watch(
  () => (props.nested ? props.fields.findIndex((_, index) => hasErrors(index)) : -1),
  (index) => {
    const field = props.fields[index];
    if (field) openField.value = field.id;
  },
  { immediate: true },
);

const { draggingKey, dropAt, onDragStart, onDragEnd, onDragOver, onDrop } = useListReorder(
  () => props.fields,
  (field) => field.id,
  (from, to) => emit('move', from, to),
);

function add(typeName: string) {
  emit('add', typeName);
  showAdd.value = false;
}

function onMenuKeydown(event: KeyboardEvent) {
  const index = indexForDigit(event);
  const meta = index === null ? undefined : props.fieldTypes[index];
  if (!meta) return;
  event.preventDefault();
  add(meta.name);
}

useShortcuts(
  () => [
    {
      keys: 'alt+n',
      label: 'Add a field',
      whileTyping: true,
      enabled: () => !props.nested && !props.readOnly && props.fieldTypes.length > 0,
      run: () => {
        showAdd.value = true;
      },
    },
  ],
  { group: 'Fields', order: 10 },
);

const root = useTemplateRef<HTMLElement>('root');

defineExpose({
  /** Opens a new field's settings with its placeholder label selected. */
  async open(id: string) {
    openField.value = id;
    await nextTick();
    const panel = root.value?.querySelector(`[data-field-settings="${id}"]`);
    const field = panel ? firstField(panel) : null;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (field instanceof HTMLInputElement) field.select();
  },
  /** Opens and scrolls to a field's settings without moving focus. */
  async reveal(id: string) {
    openField.value = id;
    await nextTick();
    root.value
      ?.querySelector(`[data-field-settings="${id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
});
</script>

<template>
  <div ref="root" :class="nested ? '' : 'mb-card'">
    <div class="mb-3 flex items-center gap-2">
      <p v-if="nested" class="mb-eyebrow">Fields in each item</p>
      <h2 v-else class="text-sm font-bold">Fields</h2>
      <span class="mb-badge">{{ fields.length }}</span>
      <div class="flex-1" />
      <DropdownMenu v-if="!readOnly" v-model:open="showAdd" class="max-h-72 w-72">
        <template #trigger>
          <button v-if="nested" type="button" class="mb-btn-outline mb-btn-sm"><Icon name="plus" /> Add field</button>
          <button v-else class="mb-btn-outline" :title="shortcutHint('alt+n', 'Add field')"><Icon name="plus" /> Add field</button>
        </template>
        <div @keydown="onMenuKeydown">
          <button v-for="(meta, index) in fieldTypes" :key="meta.name" class="mb-menu-item" @click="add(meta.name)">
            <span class="font-medium">{{ meta.label }}</span>
            <span class="ml-1 font-mono mb-meta">{{ meta.name }}</span>
            <Kbd v-if="digitFor(index)" :keys="digitFor(index)!" class="ml-auto" />
          </button>
        </div>
      </DropdownMenu>
    </div>

    <p v-if="!fields.length" class="text-sm text-surface-500">
      {{ nested ? 'No fields yet. Every item is filled against the fields you add here.' : 'No fields yet.' }}
    </p>

    <ul>
      <li v-for="(field, index) in fields" :key="field.id">
        <!-- The gap between fields is the drop target. -->
        <DropLine :active="dropAt === index" @dragover="onDragOver($event, index)" @drop="onDrop($event, index)" />

        <div
          class="overflow-hidden rounded-card border"
          :class="[
            draggingKey === field.id ? 'opacity-40' : '',
            hasErrors(index)
              ? 'border-danger-400 dark:border-danger-500'
              : 'border-surface-200 dark:border-surface-700',
          ]"
        >
          <!-- Only the header drags, so panel inputs stay selectable. -->
          <div
            class="flex items-center gap-2 mb-surface-inset px-2.5 py-2"
            :draggable="!readOnly"
            @dragstart="onDragStart($event, field.id)"
            @dragend="onDragEnd"
          >
            <Icon
              v-if="!readOnly"
              name="drag"
              class="mb-icon-sm shrink-0 cursor-grab text-surface-400"
              aria-hidden="true"
            />
            <button
              class="flex flex-1 items-center gap-2 text-left text-sm"
              @click="openField = openField === field.id ? null : field.id"
            >
              <Icon :name="openField === field.id ? 'down' : 'chevron'" class="mb-icon-sm" />
              <span class="font-medium">{{ field.label }}</span>
              <span class="font-mono mb-meta">{{ field.name }}</span>
              <span class="mb-badge font-mono">{{ field.type }}</span>
              <Icon
                v-if="hasErrors(index)"
                name="alert"
                class="mb-icon-sm text-danger-600 dark:text-danger-400"
                role="img"
                aria-label="Has errors"
              />
            </button>
            <template v-if="!readOnly">
              <button aria-label="Move up" :disabled="index === 0" @click="emit('move', index, index - 1)">
                <Icon name="undo" class="mb-icon-sm rotate-90" />
              </button>
              <button
                aria-label="Move down"
                :disabled="index === fields.length - 1"
                @click="emit('move', index, index + 1)"
              >
                <Icon name="redo" class="mb-icon-sm rotate-90" />
              </button>
              <IconButton icon="trash" label="Remove field" danger @click="emit('remove', field.id)" />
            </template>
          </div>

          <div v-if="openField === field.id" :data-field-settings="field.id" class="border-t border-surface-200 p-3 dark:border-surface-700">
            <FieldSettings
              :model-value="field"
              :read-only="readOnly"
              :locked="savedById.has(field.id)"
              :saved="savedById.get(field.id) ?? null"
              :error-for="scoped(errorFor, ['fields', index])"
              :error-under="errorUnder ? scopedUnder(errorUnder, ['fields', index]) : undefined"
              :index="settingsIndex(index)"
              :depth="depth ?? 0"
              @update:model-value="emit('update', index, $event)"
            />
          </div>
        </div>
      </li>

      <!-- Drop slot after the last field. -->
      <li v-if="fields.length">
        <DropLine :active="dropAt === fields.length" @dragover="onDragOver($event, fields.length)" @drop="onDrop($event, fields.length)" />
      </li>
    </ul>
  </div>
</template>
