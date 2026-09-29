<script setup lang="ts" generic="T extends string">
import { ref } from 'vue';
import Icon from '../Icon.vue';
import type { TabItem } from './types';

/** Tab bar with roving focus; arrows, Home and End select as they move. */

export type { TabItem };

const model = defineModel<T>({ required: true });
const props = defineProps<{
  tabs: readonly TabItem<T>[];
  ariaLabel?: string | undefined;
}>();

const buttons = ref<HTMLButtonElement[]>([]);

function select(index: number) {
  const tab = props.tabs[index];
  if (!tab) return;
  model.value = tab.id;
  buttons.value[index]?.focus();
}

function onKeydown(event: KeyboardEvent, index: number) {
  const last = props.tabs.length - 1;
  const target =
    event.key === 'ArrowRight'
      ? (index + 1) % props.tabs.length
      : event.key === 'ArrowLeft'
        ? (index - 1 + props.tabs.length) % props.tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null;
  if (target === null) return;
  event.preventDefault();
  select(target);
}
</script>

<template>
  <div class="flex gap-1 border-b border-surface-200 dark:border-surface-800" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="(item, index) in tabs"
      :key="item.id"
      ref="buttons"
      type="button"
      role="tab"
      class="mb-tab"
      :class="model === item.id ? 'mb-tab-active' : ''"
      :aria-selected="model === item.id"
      :tabindex="model === item.id ? 0 : -1"
      @click="select(index)"
      @keydown="onKeydown($event, index)"
    >
      <Icon v-if="item.icon" :name="item.icon" class="mb-icon shrink-0" />
      <span class="truncate">{{ item.label }}</span>
      <span v-if="item.count !== undefined" class="font-mono text-2xs tabular-nums">{{ item.count }}</span>
    </button>
  </div>
</template>
