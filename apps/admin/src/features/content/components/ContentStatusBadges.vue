<script setup lang="ts">
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import { formatDateTime } from '@manablox/admin-sdk/lib/format';
import type { ScheduleWindow } from '@manablox/admin-sdk/lib/schedule';
import { useDraftStore } from '../useDraftStore';

/** The open document's state pill (what it is if the tab closed now) and its schedule. */
defineProps<{
  /** A just-finished action, shown briefly. */
  status: string | null;
  isPublished: boolean;
  savedSincePublish: boolean;
  scheduled: boolean;
  schedule: ScheduleWindow;
}>();

const draft = useDraftStore();
</script>

<template>
  <!-- One pill: the state if the tab closed now. -->
  <StatusBadge v-if="draft.isDirty" status="unsaved" />
  <span v-else-if="status" class="mb-badge-ok">* {{ status }}</span>
  <StatusBadge v-else-if="isPublished && savedSincePublish" status="changed" title="Changed since it was published" />
  <StatusBadge v-else-if="isPublished" status="live" />
  <StatusBadge v-else-if="draft.doc?.id" status="draft" />
  <StatusBadge v-else status="new" />
  <span
    v-if="scheduled"
    class="mb-badge"
    :title="[
      schedule.publishAt ? `Publishes ${formatDateTime(schedule.publishAt)}` : null,
      schedule.unpublishAt ? `Unpublishes ${formatDateTime(schedule.unpublishAt)}` : null,
    ].filter(Boolean).join(' - ')"
  >
    scheduled
  </span>
</template>
