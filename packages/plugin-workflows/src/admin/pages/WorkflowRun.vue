<script setup lang="ts">
import {
  confirmAndRun,
  EditorHeader,
  formatDateTime,
  Icon,
  isNotFound,
  JsonBlock,
  PageState,
  requireSpace,
  runWrite,
  Tabs,
  useBreadcrumb,
  useCan,
} from '@manablox/admin-sdk';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isActiveRunStatus } from '../../sdk';
import WorkflowCanvas from '../components/canvas/WorkflowCanvas.vue';
import RunSteps from '../components/RunSteps.vue';
import { isBuiltinTriggerKind, toDraft, triggerKind, workflowNames } from '../model';
import {
  abortedBy,
  RUN_STATUS,
  runDuration,
  runMessage,
  statusesOf,
  triggerLabel,
} from '../model/runs';
import { useWorkflowCatalog, useWorkflowRun, workflows as workflowActions } from '../queries';

/** One run step by step, on the graph it walked. */
const route = useRoute();
const router = useRouter();

const workflowId = computed(() => route.params.id as string);
const runId = computed(() => route.params.runId as string);
const { data: run, isLoading, error, refetch } = useWorkflowRun(runId);
const notFound = computed(() => isNotFound(error.value));
const { data: catalog } = useWorkflowCatalog();
const canWrite = useCan('workflows:write');

const name = computed(() => run.value?.definition?.name ?? run.value?.context.workflow.name ?? '');
useBreadcrumb(() => (name.value ? `${name.value}: run` : null));

/** The walked definition, in the shape the canvas draws. */
const graph = computed(() => {
  const definition = run.value?.definition;
  return definition ? toDraft(definition, true) : null;
});

const selectedId = ref<string | null>(null);
const statuses = computed(() => statusesOf(run.value?.log ?? []));
const names = computed(() => workflowNames(catalog.value?.callable));

const document = computed(() => {
  const content = run.value?.context.content as { id?: unknown; title?: unknown } | null;
  return content && typeof content.id === 'string'
    ? { id: content.id, title: typeof content.title === 'string' ? content.title : 'A document' }
    : null;
});

/** What the run started from, without what its nodes produced. */
const started = computed(() => {
  if (!run.value) return null;
  const { nodes: _nodes, ...context } = run.value.context;
  return context;
});
const result = computed(() => run.value?.state.result);
const hasResult = computed(() => result.value !== undefined && result.value !== null);

/** The slot entry of the contributed kind that started the run, e.g. an incoming call's. */
const startedKind = computed(() => {
  const trigger = run.value?.trigger;
  return trigger && !isBuiltinTriggerKind(trigger) ? triggerKind(trigger).entry : undefined;
});
const startPart = computed(() => startedKind.value?.startPart);
/** Words after the label, e.g. `to Orders`. */
const startedBy = computed(() => {
  const context = run.value?.context;
  return context ? (startedKind.value?.startedBy?.(context) ?? null) : null;
});

/** The parts of the start a run is usually about, each under the path templates read it by. */
const startParts = computed(() => {
  const context = run.value?.context;
  if (!context) return [];
  const parts: Array<{ label: string; path: string; value: unknown }> = [];
  if (context.input && Object.keys(context.input).length)
    parts.push({ label: 'Input', path: 'input', value: context.input });
  const own = startPart.value?.(context);
  if (own) parts.push({ ...own, value: context[own.path] });
  if (context.content) parts.push({ label: 'Document', path: 'content', value: context.content });
  if (context.documents.length)
    parts.push({ label: 'Documents', path: 'documents', value: context.documents });
  return parts;
});
/** The whole start opens by itself when nothing stands out. */
const showContext = ref(false);
watch(
  () => startParts.value.length,
  (count) => {
    if (!count) showContext.value = true;
  },
  { immediate: true },
);

type Panel = 'steps' | 'started' | 'result';
const panel = ref<Panel>('steps');
const panels = computed(() => [
  { id: 'steps' as Panel, label: 'Steps', icon: 'list', count: run.value?.log.length ?? 0 },
  { id: 'started' as Panel, label: 'Started with', icon: 'braces' },
  ...(hasResult.value ? [{ id: 'result' as Panel, label: 'Handed back', icon: 'flag' }] : []),
]);

/** A node picked on the canvas shows its steps. */
function select(id: string | null) {
  selectedId.value = id;
  if (id) panel.value = 'steps';
}

const busy = ref(false);

function abort() {
  const current = run.value;
  if (!current) return;
  return confirmAndRun(
    {
      title: 'Abort this run?',
      message: 'It stops where it is. What it already did is not undone.',
      confirmLabel: 'Abort run',
      danger: true,
    },
    () => workflowActions.abortRun(requireSpace(), current.id),
    { success: 'Aborted the run', busy },
  );
}

/** Test-runs the draft again with this run's sample. */
function again() {
  const current = run.value;
  if (!current) return;
  const context = current.context;
  return runWrite(
    async () => {
      const next = await workflowActions.runNow(requireSpace(), workflowId.value, {
        contentId: document.value?.id ?? null,
        input: context.input ?? null,
        payload: context.payload ?? null,
        headers: context.headers ?? null,
      });
      await router.push(`/workflows/${workflowId.value}/runs/${next.id}`);
    },
    { busy },
  );
}
</script>

<template>
  <PageState :ready="Boolean(run)" :loading="isLoading" :error="notFound ? null : error" :retry="refetch" :not-found="notFound" loading-label="Loading run..." not-found-title="Run not found" not-found-icon="workflow" back-to="/workflows" back-label="All workflows" class="wf:h-full">
    <!-- Fills the scroller when wide, so only the steps scroll. -->
    <div v-if="run" class="mb-page-wide wf:flex wf:min-h-full wf:flex-col">
      <EditorHeader :title="name || 'Workflow run'" eyebrow="Workflow run">
        <template #badge>
          <span class="mb-badge" :class="RUN_STATUS[run.status].badge">{{ RUN_STATUS[run.status].label }}</span>
          <span v-if="run.test" class="mb-badge mb-badge-brand" title="Part of a test run">test</span>
          <RouterLink v-if="run.version" :to="`/workflows/${workflowId}/versions/${run.version}`" class="mb-badge wf:font-mono wf:hover:underline" :title="`It ran version ${run.version}`">v{{ run.version }}</RouterLink>
        </template>
        <RouterLink :to="`/workflows/${workflowId}`" class="mb-btn-outline">
          <Icon name="workflow" /> Open the workflow
        </RouterLink>
        <button v-if="canWrite && run.test && run.trigger === 'manual'" type="button" class="mb-btn-outline" :disabled="busy" title="Test the current draft again with the same input" @click="again">
          <Icon name="play" /> Test again
        </button>
        <button v-if="canWrite && isActiveRunStatus(run.status)" type="button" class="mb-btn-ghost-danger" :disabled="busy" @click="abort">
          <Icon name="stop" /> Abort
        </button>
      </EditorHeader>

      <section class="mb-card wf:mb-4">
        <dl class="wf:grid wf:gap-x-6 wf:gap-y-3 wf:text-sm wf:sm:grid-cols-2 wf:lg:grid-cols-4">
          <div>
            <dt class="mb-eyebrow">Started by</dt>
            <dd>
              {{ triggerLabel(run.trigger, run.test) }}
              <template v-if="run.context.caller">
                from <RouterLink :to="`/workflows/${run.context.caller.workflowId}/runs/${run.context.caller.runId}`" class="mb-link">{{ run.context.caller.workflowName }}</RouterLink>
              </template>
              <template v-else-if="startedBy && !run.test"> {{ startedBy }}</template>
              <template v-else-if="run.trigger === 'manual' && run.context.actor"> by {{ run.context.actor.name || run.context.actor.email }}</template>
            </dd>
          </div>
          <div>
            <dt class="mb-eyebrow">When</dt>
            <dd>{{ formatDateTime(run.createdAt) }}</dd>
          </div>
          <div>
            <dt class="mb-eyebrow">Took</dt>
            <dd>
              <template v-if="run.startedAt">{{ runDuration(run.startedAt, run.finishedAt) }}{{ run.finishedAt ? '' : ' so far' }}</template>
              <template v-else>Not started</template>
            </dd>
          </div>
          <div>
            <dt class="mb-eyebrow">What it ran</dt>
            <dd>
              <RouterLink v-if="run.version" :to="`/workflows/${workflowId}/versions/${run.version}`" class="mb-link">Version {{ run.version }}</RouterLink>
              <template v-else-if="run.test">The draft as it was then</template>
              <template v-else>The workflow as it was then</template>
            </dd>
          </div>
          <div v-if="document">
            <dt class="mb-eyebrow">Document</dt>
            <dd class="wf:truncate"><RouterLink :to="`/content/${document.id}`" class="mb-link">{{ document.title }}</RouterLink></dd>
          </div>
          <div v-else-if="run.context.documents.length">
            <dt class="mb-eyebrow">Documents</dt>
            <dd>{{ run.context.documents.length }} selected</dd>
          </div>
          <div v-if="run.status === 'waiting'">
            <dt class="mb-eyebrow">Waiting</dt>
            <dd>
              <template v-if="run.resumeAt">until {{ formatDateTime(run.resumeAt) }}</template>
              <template v-else-if="run.state.awaiting">for the workflow it called</template>
            </dd>
          </div>
        </dl>
        <p v-if="run.error" class="mb-callout wf:mt-3 wf:text-xs" role="alert">{{ runMessage(run.error, run.errorKey, run.errorParams) }}</p>
        <p v-if="run.status === 'aborted'" class="mb-callout wf:mt-3 wf:text-xs">{{ abortedBy(run.abort) }}</p>
      </section>

      <div class="wf:@container wf:flex wf:flex-1 wf:flex-col">
        <div class="wf:grid wf:flex-1 wf:gap-4 wf:@4xl:grid-cols-[minmax(0,1fr)_22rem] wf:@6xl:grid-cols-[minmax(0,1fr)_24rem] wf:@7xl:grid-cols-[minmax(0,1fr)_28rem] wf:@4xl:grid-rows-[minmax(0,1fr)]">
          <div class="wf:relative wf:h-[60dvh] wf:min-h-[26rem] wf:overflow-hidden wf:@4xl:h-auto wf:rounded-card wf:border wf:border-surface-200 wf:dark:border-surface-800">
            <WorkflowCanvas
              v-if="graph"
              :draft="graph"
              :actions="catalog?.actions ?? []"
              :read-only="true"
              :selected-id="selectedId"
              :run-statuses="statuses"
              :workflow-names="names"
              @select="select"
            />
            <p v-else class="wf:p-4 wf:text-sm wf:text-surface-500">The graph this run walked is no longer known.</p>
          </div>

          <!-- Absolute when wide, so the steps never stretch the row. -->
          <section class="mb-card wf:relative wf:min-w-0 wf:p-0">
            <div class="wf:flex wf:flex-col wf:@4xl:absolute wf:@4xl:inset-0">
              <Tabs v-model="panel" class="wf:shrink-0 wf:px-2 wf:pt-1" :tabs="panels" aria-label="Run details" />

              <div class="wf:min-h-0 wf:flex-1 wf:overflow-y-auto wf:p-3">
                <template v-if="panel === 'steps'">
                  <div v-if="selectedId" class="wf:mb-2 wf:flex wf:items-center wf:justify-end">
                    <button type="button" class="mb-btn-ghost mb-btn-sm" @click="selectedId = null">Clear selection</button>
                  </div>
                  <RunSteps :key="run.id" :log="run.log" :actions="catalog?.actions ?? []" :selected-id="selectedId" @select="selectedId = $event" />
                </template>

                <div v-else-if="panel === 'started'" class="wf:space-y-4">
                  <p class="mb-meta">What templates could read besides the node outputs.</p>
                  <div v-for="part in startParts" :key="part.path" class="wf:space-y-1">
                    <div class="wf:flex wf:items-baseline wf:gap-2">
                      <h3 class="wf:text-xs wf:font-bold">{{ part.label }}</h3>
                      <code class="wf:font-mono wf:text-2xs wf:text-surface-400" v-text="`{{ ${part.path} }}`" />
                    </div>
                    <JsonBlock :value="part.value" :label="part.label.toLowerCase()" />
                  </div>
                  <div class="wf:space-y-1">
                    <button type="button" class="wf:flex wf:items-center wf:gap-1 wf:text-xs wf:font-bold wf:hover:underline" :aria-expanded="showContext" @click="showContext = !showContext">
                      <Icon name="chevron" class="mb-icon-sm wf:transition-transform" :class="showContext ? 'wf:rotate-90' : ''" /> Everything
                    </button>
                    <JsonBlock v-if="showContext" :value="started" label="what it started with" max-height="max-h-[32rem]" />
                  </div>
                </div>

                <div v-else class="wf:space-y-1">
                  <p class="mb-meta">What the run handed back to whatever started it.</p>
                  <JsonBlock :value="result" label="what it handed back" max-height="max-h-[32rem]" />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

  </PageState>
</template>
