<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Kbd from '@manablox/admin-sdk/components/ui/Kbd.vue';
import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { digitFor } from '@manablox/admin-sdk/lib/shortcuts';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { typeByDigit } from '../model/block-types';

/** The visual editor's type choice for a new block; digits pick. */
const props = defineProps<{ types: ContentTypeSummary[] }>();

const emit = defineEmits<{ pick: [typeId: string]; cancel: [] }>();

function onKeydown(event: KeyboardEvent) {
  const type = typeByDigit(event, props.types);
  if (type) emit('pick', type.id);
}
</script>

<template>
  <section class="space-y-3 p-4">
    <div class="flex items-center gap-2">
      <h3 class="mb-eyebrow flex-1">Add a block</h3>
      <IconButton icon="x" label="Cancel" @click="emit('cancel')" />
    </div>
    <p v-if="types.length === 0" class="mb-hint">No block types are allowed in this field.</p>
    <div v-else class="grid gap-2" data-add-choices @keydown="onKeydown">
      <button
        v-for="(type, index) in types"
        :key="type.id"
        type="button"
        class="mb-menu-item mb-card items-center text-left"
        @click="emit('pick', type.id)"
      >
        <Icon :name="typeIcon(type, 'blocks')" class="mb-icon shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{{ type.label }}</span>
          <span v-if="type.description" class="block mb-meta">{{ type.description }}</span>
        </span>
        <Kbd v-if="digitFor(index)" :keys="digitFor(index)!" />
      </button>
    </div>
  </section>
</template>
