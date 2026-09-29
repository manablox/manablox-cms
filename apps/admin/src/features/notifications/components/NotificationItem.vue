<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { relativeTime } from '@manablox/admin-sdk/lib/format';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { type Notification, notifications } from '../queries';

/** One inbox row. Opening it marks it read and follows its link. */
const props = withDefaults(
  defineProps<{
    notification: Notification;
    /** Popover form: no delete, one line of body. */
    compact?: boolean;
  }>(),
  { compact: false },
);
const emit = defineEmits<{ opened: [] }>();

const router = useRouter();
const spaces = useSpaceStore();

const ICONS: Record<string, string> = {
  'content.approvalRequested': 'hourglass',
  'content.approved': 'ok',
  'content.rejected': 'fail',
  'content.approvalWithdrawn': 'reset',
  'member.granted': 'users',
};
const icon = computed(() => ICONS[props.notification.kind] ?? 'bell');
const unread = computed(() => props.notification.readAt === null);

async function open() {
  const row = props.notification;
  if (unread.value) void runWrite(() => notifications.markRead([row.id]));
  emit('opened');
  if (!row.url) return;
  // Switch to the link's space first.
  if (row.spaceId && spaces.currentId !== row.spaceId) spaces.currentId = row.spaceId;
  await router.push(row.url);
}

function toggleRead() {
  const ids = [props.notification.id];
  return runWrite(() =>
    unread.value ? notifications.markRead(ids) : notifications.markUnread(ids),
  );
}

const remove = () =>
  confirmAndRun(
    {
      title: `Delete "${props.notification.title}"?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete notification',
      danger: true,
    },
    () => notifications.remove([props.notification.id]),
  );
</script>

<template>
  <div
    class="group flex items-start gap-3 rounded-control border-l-2 px-2 py-2 transition"
    :class="unread ? 'border-brand-500 bg-brand-50 dark:bg-brand-600/20' : 'border-transparent'"
  >
    <button type="button" class="flex min-w-0 flex-1 items-start gap-3 text-left" @click="open">
      <span
        class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control"
        :class="unread ? 'mb-tile-clay' : 'bg-surface-100 text-surface-500 dark:bg-surface-800'"
      >
        <Icon :name="icon" class="mb-icon" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="flex items-start gap-2">
          <span class="min-w-0 flex-1 text-sm leading-snug" :class="unread ? 'font-semibold text-surface-900 dark:text-surface-50' : 'font-medium text-surface-700 dark:text-surface-300'">
            {{ notification.title }}
          </span>
          <span v-if="unread" class="mt-1.5 h-2 w-2 shrink-0 rounded-pill bg-brand-600" aria-label="Unread" />
        </span>
        <span
          v-if="notification.body"
          class="mt-0.5 block text-xs text-surface-600 dark:text-surface-400"
          :class="compact ? 'truncate' : ''"
        >
          {{ notification.body }}
        </span>
        <span class="mt-1 block text-2xs text-surface-400">
          {{ relativeTime(notification.createdAt) }}<template v-if="notification.actorLabel"> - {{ notification.actorLabel }}</template>
        </span>
      </span>
    </button>
    <span class="mb-row-action flex shrink-0 items-center gap-0.5">
      <IconButton :icon="unread ? 'check' : 'bell'" :label="unread ? 'Mark as read' : 'Mark as unread'" @click="toggleRead" />
      <IconButton v-if="!compact" icon="trash" label="Delete notification" title="Delete" danger @click="remove" />
    </span>
  </div>
</template>
