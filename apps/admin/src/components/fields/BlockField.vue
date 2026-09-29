<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import type { BlockValue } from '@manablox/core';
import { computed } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import BlockEditor from '~/features/content/components/BlockEditor.vue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [BlockValue | null] }>();

const context = useFieldContext();
const block = computed(() => (props.modelValue as BlockValue | null) ?? null);
const type = computed(() => context.value.typeById(props.settings.type as string));
/** The server validates the single block as the first of a list, so its path carries index 0. */
const blockPath = computed(() => [...props.path, 0]);
const invalid = computed(() => context.value.errorUnder(blockPath.value));

function create() {
  emit('update:modelValue', {
    blockId: crypto.randomUUID(),
    type: props.settings.type as string,
    fields: {},
  });
}
</script>

<template>
  <div v-if="!block">
    <p v-if="context.readOnly" class="mb-hint">No {{ type?.label ?? 'block' }}.</p>
    <button v-else type="button" class="mb-btn-ghost border border-dashed border-surface-300 dark:border-surface-700" @click="create">
      <Icon name="plus" /> Add {{ type?.label ?? 'block' }}
    </button>
  </div>

  <div
    v-else
    class="rounded-control border dark:border-surface-700"
    :class="invalid ? 'mb-invalid border-danger-400 dark:border-danger-500' : 'border-surface-200'"
    :data-invalid="invalid ? '' : undefined"
  >
    <div class="flex items-center gap-2 mb-surface-inset px-2 py-1.5 text-sm">
      <span class="flex-1 font-medium">{{ type?.label }}</span>
      <IconButton v-if="!context.readOnly" icon="trash" label="Remove block" danger @click="emit('update:modelValue', null)" />
    </div>
    <div class="p-3">
      <BlockEditor
        :block="block"
        :path="blockPath"
        @update:fields="emit('update:modelValue', { ...block, fields: $event })"
      />
      <PluginSlot
        v-if="context.blockInspectors"
        id="block.inspector"
        :props="{ block, type, path: blockPath, readOnly: context.readOnly, update: (next) => emit('update:modelValue', next) }"
      />
    </div>
  </div>
</template>
