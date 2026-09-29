<script setup lang="ts" generic="T">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { computed } from 'vue';
import DropLine from '~/components/DropLine.vue';
import { useListReorder } from '~/composables/useListReorder';

/** Compact rows reordered by drag or the move buttons. */
const props = defineProps<{
  items: readonly T[];
  keyOf: (item: T) => string;
  readOnly?: boolean | undefined;
}>();
const emit = defineEmits<{ move: [from: number, to: number] }>();
defineSlots<{
  default(props: { item: T; index: number }): unknown;
  /** Trailing buttons, after the move buttons. */
  actions?(props: { item: T; index: number }): unknown;
}>();

const sortable = computed(() => !props.readOnly && props.items.length > 1);

const { draggingKey, dropAt, onDragStart, onDragEnd, onDragOver, onDrop } = useListReorder(
  () => props.items,
  (item) => props.keyOf(item),
  (from, to) => emit('move', from, to),
);
</script>

<template>
  <ul>
    <li v-for="(item, index) in items" :key="keyOf(item)">
      <DropLine v-if="sortable" :active="dropAt === index" @dragover="onDragOver($event, index)" @drop="onDrop($event, index)" />
      <div
        class="flex items-center gap-2 rounded-control border border-surface-200 px-2.5 py-1.5 text-sm dark:border-surface-700"
        :class="[draggingKey === keyOf(item) ? 'opacity-40' : '', sortable || index === 0 ? '' : 'mt-1']"
        :draggable="sortable"
        :data-item="index"
        @dragstart="onDragStart($event, keyOf(item))"
        @dragend="onDragEnd"
      >
        <Icon v-if="sortable" name="drag" class="mb-icon-sm shrink-0 cursor-grab text-surface-400" aria-hidden="true" />
        <slot :item="item" :index="index" />
        <template v-if="sortable">
          <IconButton icon="up" label="Move up" :disabled="index === 0" @click="emit('move', index, index - 1)" />
          <IconButton icon="down" label="Move down" :disabled="index === items.length - 1" @click="emit('move', index, index + 1)" />
        </template>
        <slot name="actions" :item="item" :index="index" />
      </div>
    </li>
    <li v-if="sortable">
      <DropLine :active="dropAt === items.length" @dragover="onDragOver($event, items.length)" @drop="onDrop($event, items.length)" />
    </li>
  </ul>
</template>
