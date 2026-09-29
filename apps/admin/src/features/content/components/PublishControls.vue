<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Popover from '@manablox/admin-sdk/components/ui/Popover.vue';
import ScheduleFields from '@manablox/admin-sdk/components/ui/ScheduleFields.vue';
import type { ScheduleWindow } from '@manablox/admin-sdk/lib/schedule';
import { shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import { useFeature } from '@manablox/admin-sdk/lib/space';
import { computed } from 'vue';

/** Publish, unpublish and the schedule popover of the content editor's header. */
const props = defineProps<{
  isPublished: boolean;
  canPublishNow: boolean;
  scheduled: boolean;
  schedule: ScheduleWindow;
  savingSchedule: boolean;
  /** Only saved documents can be unpublished or scheduled. */
  saved: boolean;
}>();
const showSchedule = defineModel<boolean>('showSchedule', { required: true });
const emit = defineEmits<{ publish: []; unpublish: []; saveSchedule: [window: ScheduleWindow] }>();

const scheduling = useFeature('scheduledPublishing');
/** Saved dates stay clearable while scheduling is off. */
const clearable = computed(
  () =>
    props.saved &&
    !scheduling.value.enabled &&
    Boolean(props.schedule.publishAt || props.schedule.unpublishAt),
);
</script>

<template>
  <button
    class="mb-btn-primary"
    :disabled="!canPublishNow"
    :title="shortcutHint('mod+enter', 'Publish')"
    @click="emit('publish')"
  >
    Publish
  </button>
  <button v-if="saved" class="mb-btn-ghost" :disabled="!isPublished" @click="emit('unpublish')">
    Unpublish
  </button>
  <button
    v-if="clearable"
    class="mb-btn-ghost"
    :disabled="savingSchedule"
    title="Remove the saved publish and unpublish dates"
    @click="emit('saveSchedule', { publishAt: null, unpublishAt: null })"
  >
    <Icon name="clock" /> Clear schedule
  </button>
  <FeatureGate v-if="saved" feature="scheduledPublishing" label="Schedule" trigger-class="mb-btn-ghost" align="end">
  <Popover v-model:open="showSchedule" align="end" class="w-80">
    <template #trigger>
      <button
        class="mb-btn-ghost"
        :class="scheduled ? 'text-brand-600 dark:text-brand-300' : ''"
        :aria-pressed="showSchedule"
        :title="scheduled ? 'This document is scheduled' : 'Publish or unpublish it later'"
        aria-label="Schedule"
      >
        <Icon name="clock" /> Schedule
      </button>
    </template>
    <h3 class="mb-1 text-sm font-bold">Schedule</h3>
    <p class="mb-hint mb-3">
      The dates are checked every few seconds. Publishing by hand clears the publish
      date; the takedown date stays.
    </p>
    <ScheduleFields
      id-prefix="content-schedule"
      :window="schedule"
      :saving="savingSchedule"
      publish-hint="Goes live at this time. Leave empty to publish by hand."
      unpublish-hint="Comes down again at this time. Leave empty to stay live."
      @save="emit('saveSchedule', $event)"
    />
  </Popover>
  </FeatureGate>
</template>
