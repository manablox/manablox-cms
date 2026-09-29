<script setup lang="ts">
import type { AdminMenuItem } from '@manablox/admin-plugin';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { RouterLink } from 'vue-router';

/** One sidebar entry; icon only when collapsed. A locked entry shows a lock and still opens. */
withDefaults(
  defineProps<{ item: AdminMenuItem; collapsed: boolean; active: boolean; locked?: boolean }>(),
  { locked: false },
);
</script>

<template>
  <RouterLink
    :to="item.to"
    class="mb-list-item mb-list-item-lg font-medium"
    :class="[
      collapsed ? 'justify-center px-0' : '',
      active
        ? 'bg-brand-600 text-white shadow-xs hover:bg-brand-600 hover:text-white'
        : 'text-surface-700 dark:text-surface-300',
    ]"
    :aria-current="active ? 'page' : undefined"
    :title="collapsed ? (locked ? `${item.label} (locked)` : item.label) : undefined"
  >
    <Icon :name="item.icon ?? 'chevron'" class="mb-icon-lg shrink-0" :class="active ? 'text-white' : 'text-surface-400 dark:text-surface-500'" />
    <span v-if="!collapsed" class="min-w-0 flex-1 truncate">{{ item.label }}</span>
    <span v-else class="sr-only">{{ item.label }}</span>
    <Icon
      v-if="locked && !collapsed"
      name="lock"
      class="mb-icon-sm shrink-0"
      :class="active ? 'text-white' : 'text-surface-400 dark:text-surface-500'"
      aria-hidden="true"
    />
    <span v-if="locked" class="sr-only">(locked)</span>
  </RouterLink>
</template>
