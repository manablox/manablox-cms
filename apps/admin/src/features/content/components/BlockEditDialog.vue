<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import type { BlockValue } from '@manablox/core';
import PluginSlot from '~/components/PluginSlot';
import BlockEditor from './BlockEditor.vue';

/** A block opened from the board: its fields and inspectors in a dialog, and Delete. */
defineProps<{
  block: BlockValue;
  label: string;
  /** Where the grid put it, as a sentence. */
  placement: string | null;
  path: (string | number)[];
  readOnly: boolean;
}>();

const emit = defineEmits<{
  'update:fields': [fields: Record<string, unknown>];
  replace: [block: BlockValue];
  remove: [];
  close: [];
}>();

const context = useFieldContext();
</script>

<template>
  <Dialog
    :title="label"
    width="max-w-4xl"
    @close="emit('close')"
  >
    <p v-if="placement" class="mb-hint mb-3">
      {{ placement }}. Drag it on the board to move or resize it.
    </p>
    <BlockEditor
      :block="block"
      :path="path"
      @update:fields="emit('update:fields', $event)"
    />
    <PluginSlot
      v-if="context.blockInspectors"
      id="block.inspector"
      :props="{ block, type: context.typeById(block.type), path, readOnly, update: (next) => emit('replace', next) }"
    />
    <template #footer="{ close }">
      <button v-if="!readOnly" type="button" class="mb-btn-ghost-danger mr-auto" @click="emit('remove')">
        <Icon name="trash" /> Delete
      </button>
      <button type="button" class="mb-btn-primary" @click="close">Done</button>
    </template>
  </Dialog>
</template>
