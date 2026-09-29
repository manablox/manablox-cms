<script setup lang="ts">
import { formatTime, Icon, toggleInSet } from '@manablox/admin-sdk';
import { ref } from 'vue';
import type { WorkflowActionMeta, WorkflowNodeLog } from '../../sdk';
import {
  calledRun,
  formatDuration,
  runMessage,
  STEP_TONE,
  stepIcon,
  stepLabel,
} from '../model/runs';

/** A run's steps in the order they ran, each with its message, output and details. */
const props = defineProps<{
  log: WorkflowNodeLog[];
  actions: WorkflowActionMeta[];
  /** The node picked on the canvas; its steps are marked. */
  selectedId: string | null;
}>();
const emit = defineEmits<{ select: [nodeId: string] }>();

/** Open panels, as `<index>:output` or `<index>:detail`. Failed steps open their details. */
const open = ref<Set<string>>(
  new Set(
    props.log.flatMap((entry, index) => (entry.status === 'failed' ? [`${index}:detail`] : [])),
  ),
);
const toggle = (key: string) => {
  open.value = toggleInSet(open.value, key);
};

const json = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
</script>

<template>
  <ol v-if="log.length" class="wf:space-y-1">
    <li
      v-for="(entry, index) in log"
      :key="index"
      class="wf:rounded-card wf:border wf:px-3 wf:py-2 wf:text-xs wf:transition-colors"
      :class="entry.nodeId === selectedId
        ? 'wf:border-brand-300 wf:bg-brand-50/60 wf:dark:border-brand-700 wf:dark:bg-brand-500/10'
        : 'wf:border-transparent wf:hover:bg-surface-50 wf:dark:hover:bg-surface-800/50'"
    >
      <div class="wf:flex wf:items-start wf:gap-2">
        <span class="wf:mt-0.5 wf:w-5 wf:shrink-0 wf:text-right wf:font-mono wf:text-2xs wf:text-surface-400">{{ index + 1 }}</span>
        <Icon :name="stepIcon(entry, actions)" class="wf:mt-0.5 mb-icon-sm wf:shrink-0 wf:text-surface-400" />
        <div class="wf:min-w-0 wf:flex-1">
          <div class="wf:flex wf:flex-wrap wf:items-center wf:gap-x-2 wf:gap-y-0.5">
            <button type="button" class="wf:font-medium wf:hover:underline" title="Show on the canvas" @click="emit('select', entry.nodeId)">
              {{ stepLabel(entry, actions) }}
            </button>
            <span class="wf:font-mono wf:text-2xs wf:text-surface-400">{{ entry.key }}</span>
            <span v-if="entry.iteration !== undefined" class="mb-badge">item {{ entry.iteration + 1 }}</span>
            <span class="wf:font-semibold wf:tracking-wide wf:uppercase" :class="STEP_TONE[entry.status]">{{ entry.status }}</span>
            <span class="wf:text-surface-400" :title="`Started ${formatTime(entry.startedAt)}`">{{ formatDuration(entry.ms) }}</span>
          </div>
          <p v-if="entry.message" class="wf:mt-0.5 wf:break-words wf:text-surface-600 wf:dark:text-surface-400">{{ runMessage(entry.message, entry.messageKey, entry.messageParams) }}</p>
          <div class="wf:mt-1 wf:flex wf:flex-wrap wf:items-center wf:gap-x-3 wf:gap-y-1">
            <button v-if="entry.output !== undefined" type="button" class="mb-link" :aria-expanded="open.has(`${index}:output`)" @click="toggle(`${index}:output`)">
              {{ open.has(`${index}:output`) ? 'Hide' : 'Show' }} output
            </button>
            <button v-if="entry.detail" type="button" class="mb-link" :aria-expanded="open.has(`${index}:detail`)" @click="toggle(`${index}:detail`)">
              {{ open.has(`${index}:detail`) ? 'Hide' : 'Show' }} details
            </button>
            <RouterLink v-if="calledRun(entry)" :to="`/workflows/${calledRun(entry)?.workflowId}/runs/${calledRun(entry)?.runId}`" class="mb-link">
              Open the run it started
            </RouterLink>
          </div>
          <template v-if="open.has(`${index}:output`)">
            <p v-if="entry.outputTruncated" class="wf:mt-1 wf:text-2xs wf:text-surface-500">Too long to keep whole; this is its start. The next nodes got all of it.</p>
            <pre class="wf:mt-1 wf:max-h-72 wf:overflow-auto mb-surface-inset wf:rounded-control wf:p-2 wf:font-mono wf:text-2xs wf:text-surface-700 wf:dark:text-surface-300">{{ json(entry.output) }}</pre>
          </template>
          <pre v-if="entry.detail && open.has(`${index}:detail`)" class="wf:mt-1 wf:max-h-72 wf:overflow-auto mb-surface-inset wf:rounded-control wf:p-2 wf:font-mono wf:text-2xs wf:text-surface-700 wf:dark:text-surface-300">{{ json(entry.detail) }}</pre>
        </div>
      </div>
    </li>
  </ol>
  <p v-else class="wf:text-sm wf:text-surface-500">No step has run yet.</p>
</template>
