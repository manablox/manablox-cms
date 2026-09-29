<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import { dayLabel } from '@manablox/admin-sdk/lib/format';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';
import NotificationItem from '~/features/notifications/components/NotificationItem.vue';
import {
  notifications,
  useNotificationInbox,
  useUnreadCount,
} from '~/features/notifications/queries';

/** The full inbox, grouped by day, with bulk actions. */
const filter = ref<'all' | 'unread'>('all');
const { data, isPending, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
  useNotificationInbox(() => filter.value === 'unread');
const { data: unread } = useUnreadCount();

const items = computed(() => data.value?.pages.flatMap((page) => page.items) ?? []);

const groups = computed(() => {
  const byDay = new Map<string, typeof items.value>();
  for (const row of items.value) {
    const day = dayLabel(row.createdAt);
    const list = byDay.get(day) ?? [];
    list.push(row);
    byDay.set(day, list);
  }
  return [...byDay.entries()].map(([day, items]) => ({ day, items }));
});

function markAllRead() {
  return runWrite(() => notifications.markAllRead(), { success: 'Everything marked read' });
}

useShortcuts(() => [
  {
    keys: 'r',
    label: 'Mark everything read',
    enabled: () => (unread.value ?? 0) > 0,
    run: () => void markAllRead(),
  },
]);

function clearRead() {
  return confirmAndRun(
    {
      title: 'Remove every read notification?',
      message: 'Unread ones stay. Removed notifications cannot be brought back.',
      confirmLabel: 'Remove read',
      danger: true,
    },
    () => notifications.removeRead(),
    { success: 'Read notifications removed' },
  );
}
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader title="Notifications" description="What needed you: approvals to give, decisions on what you asked, changes to your access.">
      <template #badge>
        <span v-if="unread" class="mb-badge-brand">{{ unread }} unread</span>
      </template>
      <button v-if="unread" type="button" class="mb-btn-outline" @click="markAllRead">
        <Icon name="check" /> Mark all read
      </button>
      <button type="button" class="mb-btn-ghost-danger" @click="clearRead">
        <Icon name="trash" /> Remove read
      </button>
      <RouterLink to="/profile?tab=notifications" class="mb-btn-ghost" title="Choose what to be told about">
        <Icon name="settings" /> Preferences
      </RouterLink>
    </PageHeader>

    <SegmentedControl
      v-model="filter"
      class="mb-4"
      :options="[
        { value: 'all', label: 'All' },
        { value: 'unread', label: 'Unread' },
      ]"
      aria-label="Show"
    />

    <AsyncList
      :pending="isPending"
      :error="error"
      :retry="refetch"
      :items="items"
      :rows="6"
      empty="block"
      empty-icon="bell"
      :empty-title="filter === 'unread' ? 'Nothing unread' : 'Nothing yet'"
      :empty-description="filter === 'unread' ? 'You are up to date.' : 'When something needs you, it shows up here.'"
    >
    <div class="space-y-5">
      <section v-for="group in groups" :key="group.day">
        <h2 class="mb-eyebrow mb-1 px-2">{{ group.day }}</h2>
        <div class="mb-card space-y-0.5 p-1">
          <NotificationItem v-for="row in group.items" :key="row.id" :notification="row" />
        </div>
      </section>
      <div v-if="hasNextPage" class="text-center">
        <button
          type="button"
          class="mb-btn-outline"
          :disabled="isFetchingNextPage"
          @click="fetchNextPage()"
        >
          {{ isFetchingNextPage ? 'Loading...' : 'Show more' }}
        </button>
      </div>
    </div>
    </AsyncList>
  </div>
</template>
