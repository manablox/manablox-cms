<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import { downloadBlob } from '@manablox/admin-sdk/lib/download';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import {
  canRestore,
  downloadName,
  RESTORE_MODES,
  type RestoreMode,
  type SnapshotRow,
  scheduleText,
  snapshotRow,
} from '../model';
import { snapshots, useSnapshots } from '../queries';

/** Settings -> Backups: the space's snapshots, taken here or on a schedule, and restores. */
const spaces = useSpaceStore();
const session = useSessionStore();
const { data, isPending, error: loadError, refetch } = useSnapshots();

const error = ref<string | null>(null);
const creating = ref(false);
const rows = computed(() => data.value?.items.map(snapshotRow));
const schedule = computed(() =>
  data.value ? scheduleText(data.value.interval, data.value.retentionDays) : '',
);
const restorable = computed(() => canRestore(session.roleIn(spaces.currentId)));

function create() {
  return runWrite(() => snapshots.create(requireSpace()), {
    success: 'Snapshot taken',
    error,
    busy: creating,
  });
}

function download(row: SnapshotRow) {
  const space = spaces.current;
  if (!space) return;
  return runWrite(
    async () =>
      downloadBlob(
        downloadName(space.machineName, row.id),
        await snapshots.download(space.id, row.id),
      ),
    { error },
  );
}

function restore(row: SnapshotRow, mode: RestoreMode) {
  const space = spaces.current;
  if (!space) return;
  const text = RESTORE_MODES[mode];
  return confirmAndRun(
    {
      title: `${text.label} from ${row.date}?`,
      message: text.message,
      confirmLabel: text.confirmLabel,
      danger: mode === 'replace',
      requireText: space.machineName,
    },
    () => snapshots.restore(space.id, row.id, mode, space.machineName),
    {
      success: mode === 'new' ? 'Restored as a new space' : 'Space replaced by the snapshot',
      error,
    },
  );
}
</script>

<template>
  <Panel
    title="Backups"
    description="Snapshots of this space's content, content types and settings. Files stay where they are and are kept for as long as a snapshot may need them."
    size="lg"
    :card="false"
  >
    <template #actions>
      <FeatureGate feature="snapshots" label="Create snapshot now" trigger-class="mb-btn-primary shrink-0" align="end">
        <button type="button" class="mb-btn-primary shrink-0" :disabled="creating || data?.supported === false" @click="create">
          <Icon name="archive" /> {{ creating ? 'Taking snapshot...' : 'Create snapshot now' }}
        </button>
      </FeatureGate>
    </template>

    <p v-if="data?.supported === false" class="mb-callout mb-3 text-sm" role="note">
      The storage of this installation cannot list files, so it keeps no snapshots.
    </p>
    <p v-else-if="schedule" class="mb-hint mb-3">{{ schedule }}</p>

    <AsyncList
      :pending="isPending"
      :error="loadError"
      :retry="refetch"
      :items="rows"
      empty-icon="archive"
      empty-title="No snapshots yet"
      empty-description="Create one now, or ask for automatic snapshots."
      empty="block"
      list-class="text-sm"
      item-class="flex flex-wrap items-center gap-2 py-2"
    >
      <template #item="{ item: row }">
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ row.date }}</span>
          <span class="block truncate mb-meta">{{ row.trigger }} - {{ row.size }} - {{ row.contents }}</span>
        </span>
        <button v-if="session.isSuperadmin" type="button" class="mb-btn-ghost mb-btn-sm" :aria-label="`Download the snapshot from ${row.date}`" @click="download(row)">
          <Icon name="download" /> Download
        </button>
        <template v-if="restorable">
          <button type="button" class="mb-btn-ghost mb-btn-sm" @click="restore(row, 'new')">
            <Icon name="copy" /> As new space
          </button>
          <button type="button" class="mb-btn-ghost-danger mb-btn-sm" @click="restore(row, 'replace')">
            <Icon name="rotate-ccw" /> Replace this space
          </button>
        </template>
      </template>
    </AsyncList>
    <p v-if="error" class="mb-error mt-2">{{ error }}</p>
  </Panel>
</template>
