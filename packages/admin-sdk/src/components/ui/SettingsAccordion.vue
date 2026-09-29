<script lang="ts">
import type { SettingsAccordionItem } from './types';

export type { SettingsAccordionItem };
</script>

<script setup lang="ts" generic="T extends SettingsAccordionItem">
import Icon from '../Icon.vue';
import Accordion from './Accordion.vue';

/**
 * Settings sections as collapsible cards: icon, title, description and summary in the row,
 * the body in the slot named by the item's `value`. Closed bodies stay mounted.
 */
defineProps<{ items: readonly T[] }>();
const open = defineModel<string[]>({ default: () => [] });

const BADGES = {
  ok: 'mb-badge-ok',
  warn: 'mb-badge-warn',
  danger: 'mb-badge-danger',
  neutral: 'mb-badge',
};
</script>

<template>
  <Accordion
    :model-value="open"
    :items="items"
    variant="cards"
    multiple
    keep-mounted
    @update:model-value="open = Array.isArray($event) ? $event : $event ? [$event] : []"
  >
    <template #trigger="{ item }">
      <span class="mb-surface-inset flex size-9 shrink-0 items-center justify-center rounded-card text-surface-500">
        <Icon :name="item.icon" class="mb-icon" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{{ item.label }}</span>
        <span v-if="item.description" class="block text-xs font-normal text-surface-500">{{ item.description }}</span>
      </span>
      <span v-if="item.summary" class="hidden max-w-[16rem] shrink-0 truncate text-right text-xs font-normal text-surface-500 md:block">
        {{ item.summary }}
      </span>
      <span v-if="item.badge" class="shrink-0" :class="BADGES[item.badge.tone ?? 'neutral']">{{ item.badge.label }}</span>
    </template>
    <template #default="{ item }">
      <slot :name="item.value" :item="item" />
    </template>
  </Accordion>
</template>
