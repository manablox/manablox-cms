<script setup lang="ts">
import {
  AsyncList,
  formatDateTime,
  Icon,
  plural,
  relativeTime,
  StatusBadge,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import { useWorkflowVersions, VERSION_PAGE_SIZE, type WorkflowVersionSummary } from '../queries';

/** A workflow's published versions, newest first, each openable and restorable. */
const props = defineProps<{
  spaceId: string | null;
  workflowId: string;
  /** Offers "Restore" on each. */
  canRestore: boolean;
  /** The draft differs from the live version. */
  draftChanged: boolean;
}>();
const emit = defineEmits<{ restore: [version: number] }>();

const { data, isPending, error, refetch, page, total } = useWorkflowVersions(
  () => props.workflowId,
  true,
  () => props.spaceId,
);

const versions = computed(() => data.value?.items);

const by = (entry: WorkflowVersionSummary) => entry.publishedBy?.label ?? null;
</script>

<template>
  <div>
    <AsyncList v-model:page="page" :pending="isPending" :error="error" :retry="refetch" :items="versions" :total="total" :page-size="VERSION_PAGE_SIZE" previous-label="Newer versions" next-label="Older versions">
      <template #empty>
        <p class="wf:text-sm wf:text-surface-500">
          Not published yet. Save your changes, then publish them: each publish is kept here as a version you can open again.
        </p>
      </template>
      <template #default="{ items }">
        <ol class="wf:text-sm">
          <li
            v-for="(entry, index) in items"
            :key="entry.version"
            class="wf:relative wf:flex wf:items-start wf:gap-3 wf:py-2.5 wf:pl-6"
          >
            <span
              aria-hidden="true"
              class="wf:absolute wf:left-[6px] wf:w-px wf:bg-surface-200 wf:dark:bg-surface-700"
              :class="[index === 0 ? 'wf:top-4' : 'wf:top-0', index === items.length - 1 ? 'wf:h-4' : 'wf:bottom-0']"
            />
            <span
              aria-hidden="true"
              class="wf:absolute wf:top-3.5 wf:left-0 wf:h-[13px] wf:w-[13px] wf:rounded-pill wf:border-2 wf:border-surface-0 wf:dark:border-surface-900"
              :class="entry.live ? 'wf:bg-ok-500' : 'wf:bg-surface-300 wf:dark:bg-surface-600'"
            />
            <div class="wf:min-w-0 wf:flex-1">
              <div class="wf:flex wf:flex-wrap wf:items-center wf:gap-x-2 wf:gap-y-1">
                <RouterLink
                  :to="`/workflows/${workflowId}/versions/${entry.version}`"
                  class="wf:font-mono wf:text-xs wf:font-semibold wf:hover:underline"
                  :aria-label="`Open version ${entry.version}`"
                >
                  v{{ entry.version }}
                </RouterLink>
                <StatusBadge v-if="entry.live" status="live" :title="draftChanged ? 'Triggers run this version; the draft has changes since' : 'Triggers run this version'" />
                <span class="wf:truncate wf:font-medium">{{ entry.name }}</span>
                <span class="mb-meta" :title="formatDateTime(entry.createdAt)">{{ relativeTime(entry.createdAt) }}</span>
                <span v-if="by(entry)" class="wf:truncate mb-meta">by {{ by(entry) }}</span>
                <span class="wf:text-xs wf:text-surface-400">{{ plural(entry.nodes, 'node') }}</span>
              </div>
              <p v-if="entry.note" class="wf:mt-0.5 wf:break-words wf:text-xs wf:text-surface-600 wf:dark:text-surface-400">{{ entry.note }}</p>
            </div>
            <RouterLink
              :to="`/workflows/${workflowId}/versions/${entry.version}`"
              class="mb-btn-ghost mb-btn-sm"
              :aria-label="`View version ${entry.version}`"
            >
              <Icon name="eye" class="mb-icon-sm" /> View
            </RouterLink>
            <button
              v-if="canRestore"
              type="button"
              class="mb-btn-ghost mb-btn-sm"
              :title="`Copy version ${entry.version} into the draft`"
              @click="emit('restore', entry.version)"
            >
              <Icon name="undo" class="mb-icon-sm" /> Restore
            </button>
          </li>
        </ol>
      </template>
    </AsyncList>
  </div>
</template>
