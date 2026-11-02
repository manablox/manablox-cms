<script setup lang="ts">
import {
  AsyncList,
  confirmAndRun,
  Dialog,
  formatDateTime,
  Icon,
  relativeTime,
  StatusBadge,
} from '@manablox/admin-sdk';
import { design, type SiteDesignSummary, useDesignVersions } from '../queries';

/** A design's publish history; restoring copies a version into the draft. */
const props = defineProps<{
  spaceId: string;
  summary: SiteDesignSummary & { id: string };
  canRestore: boolean;
}>();
const emit = defineEmits<{ close: []; restored: [] }>();

const { data, isPending, error, refetch } = useDesignVersions(
  () => props.summary.id,
  () => props.spaceId,
);

async function restore(versionId: string, version: number) {
  const ok = await confirmAndRun(
    {
      title: `Restore version ${version}?`,
      message: `The draft of "${props.summary.label}" becomes version ${version}. The live site keeps its design until you publish.`,
      confirmLabel: 'Restore to draft',
    },
    () => design.restore(props.spaceId, props.summary.id, versionId),
    { success: `Restored version ${version} of "${props.summary.label}" to the draft` },
  );
  if (ok) emit('restored');
}
</script>

<template>
  <Dialog :title="`Versions of ${summary.label}`" width="max-w-lg" dismissable @close="emit('close')">
    <AsyncList :pending="isPending" :error="error" :retry="refetch" :items="data">
      <template #empty>
        <p class="ws:text-sm ws:text-surface-500">Not published yet. Each publish is kept here as a version you can restore.</p>
      </template>
      <template #default="{ items }">
        <ol class="ws:text-sm">
          <li v-for="(entry, index) in items" :key="entry.id" class="ws:flex ws:items-center ws:gap-3 ws:border-b ws:border-surface-100 ws:py-2.5 ws:last:border-0 ws:dark:border-surface-800">
            <span class="ws:font-mono ws:text-xs ws:font-semibold">v{{ entry.version }}</span>
            <StatusBadge v-if="index === 0 && (summary.status === 'published' || summary.status === 'changed')" status="live" />
            <span class="ws:min-w-0 ws:flex-1 ws:truncate mb-meta" :title="formatDateTime(entry.createdAt)">
              published {{ relativeTime(entry.createdAt) }}
            </span>
            <button
              v-if="canRestore"
              type="button"
              class="mb-btn-ghost mb-btn-sm"
              :title="`Copy version ${entry.version} into the draft`"
              @click="restore(entry.id, entry.version)"
            >
              <Icon name="undo" class="mb-icon-sm" /> Restore
            </button>
          </li>
        </ol>
      </template>
    </AsyncList>
  </Dialog>
</template>
