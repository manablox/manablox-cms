<script setup lang="ts">
import {
  EditorHeader,
  formatDateTime,
  Icon,
  isNotFound,
  PageState,
  StatusBadge,
  useBreadcrumb,
  useCan,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { WORKFLOW_TRIGGER_ID as TRIGGER_ID } from '../../sdk';
import WorkflowCanvas from '../components/canvas/WorkflowCanvas.vue';
import NodeInspector from '../components/NodeInspector.vue';
import TriggerInspector from '../components/TriggerInspector.vue';
import { toDraft, workflowNames } from '../model';
import { useWorkflow, useWorkflowCatalog, useWorkflowVersion } from '../queries';
import { exportWorkflow, restoreVersion } from '../useWorkflowActions';

/** A published version, read-only, with a way back into the draft. */
const route = useRoute();
const router = useRouter();
const spaces = useSpaceStore();

const id = computed(() => route.params.id as string);
const number = computed(() => Number(route.params.version));
const { data: workflow } = useWorkflow(id);
const { data: version, isLoading, error, refetch } = useWorkflowVersion(id, number);
const notFound = computed(() => isNotFound(error.value));
const { data: catalog } = useWorkflowCatalog();

const canWrite = useCan('workflows:write');
const canRestore = computed(() => canWrite.value && workflow.value?.source !== 'code');
const live = computed(() => workflow.value?.publishedVersion === number.value);
const latest = computed(() => workflow.value?.publishedVersion ?? number.value);

useBreadcrumb(() => (version.value ? `${version.value.name}: v${number.value}` : null));

const graph = computed(() =>
  version.value ? toDraft(version.value, workflow.value?.enabled ?? false) : null,
);

const selectedId = ref<string | null>(null);
const names = computed(() => workflowNames(catalog.value?.callable));
const noErrors = () => null;

const restore = () =>
  restoreVersion(id.value, number.value, { after: () => router.push(`/workflows/${id.value}`) });

const exportFile = () =>
  exportWorkflow(id.value, workflow.value?.slug || version.value?.name || 'workflow', number.value);
</script>

<template>
  <PageState :ready="Boolean(version && graph)" :loading="isLoading" :error="notFound ? null : error" :retry="refetch" :not-found="notFound" loading-label="Loading version..." not-found-title="Version not found" not-found-icon="workflow" back-to="/workflows" back-label="All workflows">
    <div v-if="version && graph" class="mb-page-wide">
      <EditorHeader :title="version.name" eyebrow="Workflow version">
        <template #badge>
          <span class="mb-badge wf:font-mono">v{{ version.version }}</span>
          <StatusBadge v-if="live" status="live" title="Triggers run this version" />
          <StatusBadge status="read-only" />
        </template>
        <template #description>
          Published {{ formatDateTime(version.createdAt) }}<template v-if="version.publishedBy"> by {{ version.publishedBy.label }}</template>.
          <template v-if="version.note"> "{{ version.note }}"</template>
        </template>
        <RouterLink v-if="number > 1" :to="`/workflows/${id}/versions/${number - 1}`" class="mb-btn-ghost mb-btn-icon" :aria-label="`Version ${number - 1}`" :title="`Version ${number - 1}`">
          <Icon name="chevron" class="wf:rotate-180" />
        </RouterLink>
        <RouterLink v-if="number < latest" :to="`/workflows/${id}/versions/${number + 1}`" class="mb-btn-ghost mb-btn-icon" :aria-label="`Version ${number + 1}`" :title="`Version ${number + 1}`">
          <Icon name="chevron" />
        </RouterLink>
        <button class="mb-btn-outline" title="Download this version as a JSON file to import elsewhere" @click="exportFile">
          <Icon name="download" /> Export
        </button>
        <button v-if="canRestore" class="mb-btn-outline" title="Copy this version into the draft" @click="restore">
          <Icon name="undo" /> Restore to the draft
        </button>
        <RouterLink :to="`/workflows/${id}`" class="mb-btn-primary">Open the draft</RouterLink>
      </EditorHeader>

      <div class="wf:@container">
        <div class="wf:grid wf:min-h-0 wf:gap-4 wf:@4xl:grid-cols-[minmax(0,1fr)_19rem] wf:@[90rem]:grid-cols-[minmax(0,1fr)_22rem]">
          <div class="wf:relative wf:h-[calc(100dvh-15rem)] wf:min-h-[30rem] wf:overflow-hidden wf:rounded-card wf:border wf:border-surface-200 wf:dark:border-surface-800">
            <WorkflowCanvas
              :draft="graph"
              :actions="catalog?.actions ?? []"
              :read-only="true"
              :selected-id="selectedId"
              :run-statuses="{}"
              :workflow-names="names"
              @select="selectedId = $event"
            />
          </div>

          <aside class="wf:min-w-0 wf:space-y-4">
            <TriggerInspector
              v-if="selectedId === TRIGGER_ID"
              :trigger="graph.trigger"
              :abort-triggers="graph.abortTriggers"
              :space-id="spaces.currentId"
              :catalog="catalog"
              :read-only="true"
              :error-for="noErrors"
            />
            <div v-else-if="selectedId" class="mb-card">
              <NodeInspector :draft="graph" :selected-id="selectedId" :space-id="spaces.currentId" :catalog="catalog" :read-only="true" :error-for="noErrors" :self-id="id" />
            </div>
            <div v-else class="mb-card wf:space-y-2 wf:text-sm">
              <p class="mb-meta">
                This is how the workflow looked when version {{ version.version }} was published. Pick a node to see its settings, or the one at the top for the trigger.
              </p>
              <p v-if="version.description" class="wf:text-surface-600 wf:dark:text-surface-400">{{ version.description }}</p>
              <p v-if="live && workflow?.draftChanged" class="mb-callout wf:text-xs">The draft has changes that are not published yet.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>

  </PageState>
</template>
