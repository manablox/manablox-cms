<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Dialog from '@manablox/admin-sdk/components/ui/Dialog.vue';
import Kbd from '@manablox/admin-sdk/components/ui/Kbd.vue';
import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { digitFor } from '@manablox/admin-sdk/lib/shortcuts';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { typeByDigit } from '../model/block-types';

/** The type choice for a new block drawn on the board; digits pick. */
const props = defineProps<{ allowed: ContentTypeSummary[] }>();

const emit = defineEmits<{ pick: [typeId: string]; close: [] }>();

function onPickKeydown(event: KeyboardEvent) {
  const type = typeByDigit(event, props.allowed);
  if (type) emit('pick', type.id);
}
</script>

<template>
  <Dialog title="Which block?" width="max-w-md" dismissable @close="emit('close')">
    <div class="grid gap-2" @keydown="onPickKeydown">
      <button
        v-for="(type, index) in allowed"
        :key="type.id"
        type="button"
        class="mb-surface-inset rounded-control px-3 py-2 text-left text-sm hover:ring-2 hover:ring-brand-400"
        :autofocus="index === 0"
        @click="emit('pick', type.id)"
      >
        <span class="flex items-center gap-2 font-medium">
          <Icon :name="typeIcon(type, 'blocks')" class="mb-icon-sm shrink-0 text-surface-500" />
          {{ type.label }}
          <Kbd v-if="digitFor(index)" :keys="digitFor(index)!" class="ml-auto" />
        </span>
        <span v-if="type.description" class="block mb-meta">{{ type.description }}</span>
      </button>
    </div>
  </Dialog>
</template>
