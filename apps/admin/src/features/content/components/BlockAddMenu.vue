<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import Kbd from '@manablox/admin-sdk/components/ui/Kbd.vue';
import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { digitFor } from '@manablox/admin-sdk/lib/shortcuts';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { typeByDigit } from '../model/block-types';

/** A blocks field's add button: the one allowed type directly, else a menu (digits pick). */
const props = defineProps<{ allowed: ContentTypeSummary[] }>();

const showMenu = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{ add: [typeId: string] }>();

function onPickKeydown(event: KeyboardEvent) {
  const type = typeByDigit(event, props.allowed);
  if (type) emit('add', type.id);
}
</script>

<template>
  <button
    v-if="allowed.length === 1"
    type="button"
    class="mb-btn-outline border-dashed"
    @click="emit('add', allowed[0]!.id)"
  >
    <Icon name="plus" /> Add {{ allowed[0]!.label }}
  </button>
  <DropdownMenu v-else-if="allowed.length" v-model:open="showMenu" align="start">
    <template #trigger>
      <button type="button" class="mb-btn-outline border-dashed"><Icon name="plus" /> Add block</button>
    </template>
    <div @keydown="onPickKeydown">
      <button v-for="(type, index) in allowed" :key="type.id" type="button" class="mb-menu-item" @click="emit('add', type.id)">
        <Icon :name="typeIcon(type, 'blocks')" class="mb-icon-sm shrink-0 text-surface-500" />
        {{ type.label }}
        <Kbd v-if="digitFor(index)" :keys="digitFor(index)!" class="ml-auto pl-3" />
      </button>
    </div>
  </DropdownMenu>
  <p v-else class="mb-hint">No block types configured for this field.</p>
</template>
