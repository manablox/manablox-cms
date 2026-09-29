<script setup lang="ts">
import {
  AsyncList,
  confirmAndRun,
  formatDateTime,
  Icon,
  relativeTime,
  SegmentedControl,
  Select,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { isActiveRunStatus, WORKFLOW_ACTIVE_RUN_STATUSES, type WorkflowRunStatus } from '../../sdk';
import { abortedBy, RUN_STATUS, runDuration, runMessage, triggerLabel } from '../model/runs';
import { RUN_PAGE_SIZE, type RunHistoryQuery, useWorkflowRunHistory, workflows } from '../queries';

/** A workflow's run history: filterable, paged, each run opening its step-by-step page. */
const props = defineProps<{
  spaceId: string | null;
  workflowId: string;
  canAbort: boolean;
}>();

const kind = ref<'all' | 'live' | 'test'>('all');
const KINDS = [
  { value: 'all', label: 'All runs' },
  { value: 'live', label: 'Live' },
  { value: 'test', label: 'Tests' },
] as const;

const STATUS_FILTERS: Record<string, WorkflowRunStatus[] | undefined> = {
  any: undefined,
  failed: ['failed'],
  active: [...WORKFLOW_ACTIVE_RUN_STATUSES],
  succeeded: ['succeeded'],
  skipped: ['skipped'],
  aborted: ['aborted'],
};
const STATUS_OPTIONS = [
  { value: 'any', label: 'Any status' },
  { value: 'failed', label: 'Failed' },
  { value: 'active', label: 'Queued, running or waiting' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'skipped', label: 'Stopped at a condition' },
  { value: 'aborted', label: 'Aborted' },
];
const status = ref('any');

const query = computed<RunHistoryQuery>(() => ({
  status: STATUS_FILTERS[status.value],
  test: kind.value === 'all' ? undefined : kind.value === 'test',
}));

const { data, isPending, error, refetch, page, total } = useWorkflowRunHistory(
  () => props.workflowId,
  query,
  true,
  () => props.spaceId,
);

const items = computed(() => data.value?.items ?? []);

const aborting = ref(false);

function abortRun(runId: string) {
  const spaceId = props.spaceId;
  if (!spaceId) return;
  return confirmAndRun(
    {
      title: 'Abort this run?',
      message: 'It stops where it is. What it already did is not undone.',
      confirmLabel: 'Abort run',
      danger: true,
    },
    () => workflows.abortRun(spaceId, runId),
    { success: 'Aborted the run', busy: aborting },
  );
}

function abortAll() {
  const spaceId = props.spaceId;
  if (!spaceId) return;
  return confirmAndRun(
    {
      title: 'Abort every active run?',
      message:
        'Runs that are queued, running or waiting stop where they are. What they already did is not undone.',
      confirmLabel: 'Abort runs',
      danger: true,
    },
    () => workflows.abortRuns(spaceId, props.workflowId),
    {
      success: ({ aborted }) =>
        aborted.length === 1 ? 'Aborted 1 run' : `Aborted ${aborted.length} runs`,
      busy: aborting,
    },
  );
}

const runLink = (runId: string) => `/workflows/${props.workflowId}/runs/${runId}`;
</script>

<template>
  <div>
    <div class="wf:flex wf:flex-wrap wf:items-center wf:gap-2">
      <SegmentedControl v-model="kind" :options="KINDS" aria-label="Which runs" />
      <Select v-model="status" :options="STATUS_OPTIONS" variant="sm" aria-label="Status" class="wf:w-56" />
      <span class="wf:flex-1" />
      <span class="mb-meta">The last 200 runs are kept.</span>
      <button v-if="canAbort" type="button" class="mb-btn-ghost-danger mb-btn-sm" :disabled="aborting" title="Abort every queued, running or waiting run" @click="abortAll">
        <Icon name="stop" class="mb-icon-sm" /> Abort active runs
      </button>
    </div>

    <div class="wf:mt-2">
      <AsyncList v-model:page="page" :pending="isPending" :error="error" :retry="refetch" :items="items" item-class="wf:flex wf:items-center wf:gap-3 wf:py-2.5" :total="total" :page-size="RUN_PAGE_SIZE" previous-label="Newer runs" next-label="Older runs">
        <template #empty>
          <p class="wf:py-2 wf:text-sm wf:text-surface-500">
            <template v-if="status !== 'any' || kind !== 'all'">No runs match these filters.</template>
            <template v-else>No runs yet. They appear here when the trigger fires, or when you test the draft.</template>
          </p>
        </template>
        <template #item="{ item: run }">
          <Icon :name="RUN_STATUS[run.status].icon" class="mb-icon wf:shrink-0" :class="RUN_STATUS[run.status].tone" />
          <RouterLink :to="runLink(run.id)" class="wf:group wf:min-w-0 wf:flex-1" :aria-label="`Run of ${formatDateTime(run.createdAt)}`">
            <span class="wf:flex wf:flex-wrap wf:items-center wf:gap-x-2 wf:gap-y-0.5 wf:text-sm">
              <span class="wf:font-medium wf:group-hover:underline" :title="formatDateTime(run.createdAt)">{{ relativeTime(run.createdAt) }}</span>
              <span class="wf:text-surface-500">{{ triggerLabel(run.trigger, run.test) }}</span>
              <span v-if="run.caller" class="wf:truncate wf:text-surface-500">from {{ run.caller.workflowName }}</span>
              <span v-if="run.document" class="wf:truncate wf:text-surface-500">- {{ run.document.title ?? 'a document' }}</span>
              <span v-else-if="run.documents" class="wf:text-surface-500">- {{ run.documents }} documents</span>
            </span>
            <span class="wf:flex wf:flex-wrap wf:items-center wf:gap-x-2 mb-meta">
              <span v-if="run.test" class="mb-badge-brand mb-badge">test</span>
              <span v-else-if="run.version" class="wf:font-mono">v{{ run.version }}</span>
              <span>{{ run.steps === 1 ? '1 step' : `${run.steps} steps` }}</span>
              <span v-if="run.startedAt">{{ runDuration(run.startedAt, run.finishedAt) }}</span>
              <span v-if="run.failedStep" class="wf:truncate wf:text-danger-600 wf:dark:text-danger-400">failed at {{ run.failedStep.name || run.failedStep.key }}</span>
            </span>
            <span v-if="run.error" class="wf:block wf:truncate wf:text-xs wf:text-danger-600 wf:dark:text-danger-400">{{ runMessage(run.error, run.errorKey, run.errorParams) }}</span>
            <span v-if="run.status === 'aborted'" class="wf:block wf:truncate wf:text-xs wf:text-warn-700 wf:dark:text-warn-300">{{ abortedBy(run.abort) }}</span>
          </RouterLink>
          <button v-if="canAbort && isActiveRunStatus(run.status)" type="button" class="mb-btn-ghost-danger mb-btn-sm" :disabled="aborting" @click="abortRun(run.id)">
            <Icon name="stop" class="mb-icon-sm" /> Abort
          </button>
          <span class="mb-badge" :class="RUN_STATUS[run.status].badge">{{ RUN_STATUS[run.status].label }}</span>
          <Icon name="chevron" class="mb-icon-sm wf:shrink-0 wf:text-surface-400" />
        </template>
      </AsyncList>
    </div>
  </div>
</template>
