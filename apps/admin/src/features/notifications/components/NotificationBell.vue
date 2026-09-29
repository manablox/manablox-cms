<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Popover from '@manablox/admin-sdk/components/ui/Popover.vue';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';
import { notifications, useNotifications, useUnreadCount } from '../queries';
import NotificationItem from './NotificationItem.vue';

/** The top bar bell. A `Popover`, not a `DropdownMenu`, so marking one read keeps it open. */
const open = ref(false);
const { data: unread } = useUnreadCount();
const {
  data: page,
  isPending,
  error,
  refetch,
} = useNotifications(() => ({ unreadOnly: false, limit: 8 }));

const badge = computed(() => {
  const count = unread.value ?? 0;
  return count > 99 ? '99+' : count > 0 ? String(count) : null;
});

const markAllRead = () => runWrite(() => notifications.markAllRead());
</script>

<template>
  <Popover v-model:open="open" align="end" class="w-[min(24rem,calc(100vw-1rem))] p-0">
    <template #trigger>
      <button
        type="button"
        class="mb-btn-ghost mb-btn-icon relative"
        :aria-label="badge ? `Notifications, ${unread} unread` : 'Notifications'"
        :aria-expanded="open"
        title="Notifications"
      >
        <Icon :name="badge ? 'bell-ring' : 'bell'" class="mb-icon" />
        <span
          v-if="badge"
          class="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-ochre-500 px-1 text-2xs font-bold text-white"
          aria-hidden="true"
        >
          {{ badge }}
        </span>
      </button>
    </template>

    <div class="flex items-center gap-2 border-b border-surface-200 px-3 py-2 dark:border-surface-800">
      <h2 class="flex-1 text-sm font-bold">Notifications</h2>
      <button
        v-if="badge"
        type="button"
        class="mb-btn-ghost mb-btn-sm"
        @click="markAllRead"
      >
        Mark all read
      </button>
    </div>

    <div class="max-h-[60vh] overflow-y-auto p-1">
      <AsyncList :pending="isPending" :error="error" :retry="refetch" :items="page?.items" :rows="3">
        <template #empty>
          <p class="px-3 py-6 text-center text-sm text-surface-500">
            Nothing yet. When something needs you, it shows up here.
          </p>
        </template>
        <template #default="{ items }">
          <NotificationItem
            v-for="row in items"
            :key="row.id"
            :notification="row"
            compact
            @opened="open = false"
          />
        </template>
      </AsyncList>
    </div>

    <div class="border-t border-surface-200 px-3 py-2 dark:border-surface-800">
      <RouterLink to="/notifications" class="text-xs mb-link" @click="open = false">
        See every notification
      </RouterLink>
    </div>
  </Popover>
</template>
