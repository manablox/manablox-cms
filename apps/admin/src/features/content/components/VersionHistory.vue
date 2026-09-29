<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import {
  content,
  useVersions,
  VERSIONS_PAGE_SIZE,
} from '@manablox/admin-sdk/features/content/queries';
import { formatDateTime } from '@manablox/admin-sdk/lib/format';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';

/** Version history and rollback, backed by the `content_versions` snapshots. */
const props = defineProps<{ spaceId: string; contentId: string }>();
const emit = defineEmits<{ restored: [] }>();

const { data, isPending, error, refetch, page, total } = useVersions(
  () => props.contentId,
  () => props.spaceId,
);

function restore(version: number) {
  return confirmAndRun(
    {
      title: `Restore version ${version}?`,
      message: 'The current state is kept as a new version, so nothing is lost.',
      confirmLabel: 'Restore',
    },
    async () => {
      await content.restore(props.spaceId, props.contentId, version);
      emit('restored');
    },
    { success: `Restored version ${version}` },
  );
}
</script>

<template>
  <Panel title="History" size="sm">
    <AsyncList
      v-model:page="page"
      :pending="isPending"
      :error="error"
      :retry="refetch"
      :items="data?.items"
      :total="total"
      :page-size="VERSIONS_PAGE_SIZE"
    >
      <template #empty><p class="text-sm text-surface-500">No versions yet.</p></template>
      <template #default="{ items }">
        <ol class="max-h-64 overflow-auto text-sm">
          <li
            v-for="(entry, index) in items"
            :key="entry.version"
            class="relative flex items-center gap-3 py-1.5 pl-5"
          >
            <span
              aria-hidden="true"
              class="absolute top-0 bottom-0 left-[5px] w-px bg-surface-200 dark:bg-surface-700"
              :class="[index === 0 ? 'top-1/2' : '', index === items.length - 1 ? 'bottom-1/2' : '']"
            />
            <span
              aria-hidden="true"
              class="absolute top-1/2 left-0 h-[11px] w-[11px] -translate-y-1/2 rounded-pill border-2 border-surface-0 dark:border-surface-900"
              :class="index === 0 && page === 0 ? 'bg-brand-500' : 'bg-surface-300 dark:bg-surface-600'"
            />
            <span class="font-mono text-xs font-semibold">v{{ entry.version }}</span>
            <span class="flex-1 truncate mb-meta">
              {{ formatDateTime(entry.createdAt) }}
            </span>
            <FeatureGate
              feature="versionRestore"
              label="Restore"
              trigger-class="inline-flex items-center gap-1 text-xs font-medium text-surface-500"
              align="end"
            >
              <button class="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300" @click="restore(entry.version)">
                Restore
              </button>
            </FeatureGate>
          </li>
        </ol>
      </template>
    </AsyncList>
  </Panel>
</template>
