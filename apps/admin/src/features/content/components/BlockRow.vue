<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import type { BlockValue } from '@manablox/core';
import PluginSlot from '~/components/PluginSlot';
import BlockEditor from './BlockEditor.vue';

/** One block in a blocks field's list: a header to open, move, delete or drag it, and its fields when open. */
defineProps<{
  block: BlockValue;
  index: number;
  /** How many blocks the list holds. */
  count: number;
  path: (string | number)[];
  readOnly: boolean;
  open: boolean;
  invalid: boolean;
  /** The block selected on the board. */
  selected: boolean;
  dragging: boolean;
  /** Collapsed label. */
  summary: string;
  /** Its grid placement, under a grid. */
  layoutLabel: string | null;
}>();

const emit = defineEmits<{
  toggle: [];
  move: [to: number];
  remove: [];
  'update:fields': [fields: Record<string, unknown>];
  replace: [block: BlockValue];
  dragstart: [event: DragEvent];
  dragend: [];
}>();

const context = useFieldContext();
</script>

<template>
  <div
    class="overflow-hidden rounded-card border dark:border-surface-700"
    :class="[
      dragging ? 'opacity-40' : '',
      invalid ? 'mb-invalid border-danger-400 dark:border-danger-500' : '',
      selected ? 'border-brand-400 dark:border-brand-500' : 'border-surface-200',
    ]"
    :data-invalid="invalid ? '' : undefined"
  >
    <!-- Header-only drag source keeps text in open blocks selectable. -->
    <div
      class="flex items-center gap-2 mb-surface-inset px-2.5 py-2"
      :draggable="!readOnly"
      @dragstart="emit('dragstart', $event)"
      @dragend="emit('dragend')"
    >
      <Icon v-if="!readOnly" name="drag" class="mb-icon-sm shrink-0 cursor-grab text-surface-400" aria-hidden="true" />
      <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" @click="emit('toggle')">
        <Icon :name="open ? 'down' : 'chevron'" class="mb-icon-sm shrink-0" />
        <Icon :name="typeIcon(context.typeById(block.type), 'blocks')" class="mb-icon-sm shrink-0 text-surface-500" />
        <span class="font-medium">{{ context.typeById(block.type)?.label ?? 'Unknown block' }}</span>
        <span class="truncate mb-meta">{{ summary }}</span>
        <span v-if="layoutLabel" class="mb-badge shrink-0 tabular-nums">{{ layoutLabel }}</span>
      </button>
      <template v-if="!readOnly">
        <IconButton icon="up" label="Move up" :disabled="index === 0" @click="emit('move', index - 1)" />
        <IconButton icon="down" label="Move down" :disabled="index === count - 1" @click="emit('move', index + 1)" />
        <IconButton icon="trash" label="Delete block" danger @click="emit('remove')" />
      </template>
    </div>

    <div v-if="open" :data-block-panel="block.blockId" class="border-t border-surface-200 p-3 dark:border-surface-700">
      <BlockEditor
        :block="block"
        :path="[...path, index]"
        @update:fields="emit('update:fields', $event)"
      />
      <PluginSlot
        v-if="context.blockInspectors"
        id="block.inspector"
        :props="{ block, type: context.typeById(block.type), path: [...path, index], readOnly, update: (next) => emit('replace', next) }"
      />
    </div>
  </div>
</template>
