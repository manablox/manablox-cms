<script setup lang="ts">
import {
  ContentPicker,
  DropdownMenu,
  EditorHeader,
  formatDateTime,
  Icon,
  isNotFound,
  PageState,
  relativeTime,
  SaveButton,
  StatusBadge,
  Switch,
  Tabs,
  TextareaField,
  TextField,
  useCan,
  useEditorForm,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { type Component, computed, defineAsyncComponent, ref } from 'vue';
import { useRoute } from 'vue-router';
import { WORKFLOW_TRIGGER_ID as TRIGGER_ID } from '../../sdk';
import CallInputDialog from '../components/CallInputDialog.vue';
import WorkflowCanvas from '../components/canvas/WorkflowCanvas.vue';
import NodeInspector from '../components/NodeInspector.vue';
import NodePalette from '../components/NodePalette.vue';
import PublishDialog from '../components/PublishDialog.vue';
import RunHistory from '../components/RunHistory.vue';
import StartRunDialog from '../components/StartRunDialog.vue';
import TriggerInspector from '../components/TriggerInspector.vue';
import VersionList from '../components/VersionList.vue';
import { type Draft, toDraft, triggerKind, workflowNames } from '../model';
import { statusesOf } from '../model/runs';
import { type TestSample, useWorkflow, useWorkflowCatalog, useWorkflowRun } from '../queries';
import { useWorkflowActions } from '../useWorkflowActions';
import { useWorkflowGraph } from '../useWorkflowGraph';

/** The workflow editor. Lines define data flow: a node's output is readable downstream. */
const route = useRoute();
const spaces = useSpaceStore();

const id = computed(() => route.params.id as string);
const { data, isLoading, error: loadError, refetch } = useWorkflow(id);
const notFound = computed(() => isNotFound(loadError.value));
const { data: catalog } = useWorkflowCatalog();
const canWrite = useCan('workflows:write');
/** Config-declared: read-only except its switch; "Clone" makes an editable copy. */
const isCode = computed(() => data.value?.source === 'code');
const readOnly = computed(() => !canWrite.value || isCode.value);
const declaredBy = computed(() => data.value?.sourceRef ?? 'the config');
/** The version triggers run; null until first published. */
const liveVersion = computed(() => data.value?.publishedVersion ?? null);

const form = useEditorForm({
  source: data,
  toDraft: (loaded) => toDraft(loaded, loaded.enabled),
  what: 'This workflow',
  crumb: (current: Draft) => current.name,
  save: () => actions.save(),
  // Graph edits replace whole arrays, so the top-level keys are enough to watch.
  shallow: true,
  inline: ['nodes', 'edges', 'trigger', 'abortTriggers', 'name'],
});
const { draft, isDirty, saving, errors, otherErrors, fieldError } = form;

const graph = useWorkflowGraph(
  draft,
  computed(() => catalog.value?.actions),
);
const { selectedId } = graph;
const names = computed(() => workflowNames(catalog.value?.callable));

const tab = ref<'build' | 'versions' | 'runs'>('build');
const arranging = ref(false);
const canvas = ref<InstanceType<typeof WorkflowCanvas> | null>(null);
const arrange = (density: 'compact' | 'relaxed') =>
  graph.tidy(density, canvas.value?.cardHeights());
const TABS = [
  { id: 'build', label: 'Canvas', icon: 'workflow' },
  { id: 'versions', label: 'Versions', icon: 'clock' },
  { id: 'runs', label: 'Runs', icon: 'activity' },
] as const;

/** Selects the first erroring node, or the trigger; the canvas marks the rest. */
function showFirstError() {
  const flagged = errors.value.find((detail) => detail.path?.[0] === 'nodes');
  const index = typeof flagged?.path?.[1] === 'number' ? flagged.path[1] : -1;
  const node = draft.value?.nodes[index];
  const onTrigger = errors.value.some((detail) =>
    ['trigger', 'abortTriggers'].includes(String(detail.path?.[0])),
  );
  if (!node && !onTrigger) return;
  selectedId.value = node ? node.id : TRIGGER_ID;
  tab.value = 'build';
}

const actions = useWorkflowActions({
  id,
  form,
  workflow: data,
  readOnly,
  isCode,
  onInvalid: showFirstError,
  onRestored: () => {
    tab.value = 'build';
  },
});
const { askingPublish, publishing, inspectedRun, running, asking, canPublish } = actions;

/** Manual workflows run their live version from here; code ones too. */
const startable = computed(
  () => canWrite.value && data.value?.triggerKind === 'manual' && liveVersion.value !== null,
);
const starting = ref(false);

const { data: shownRun } = useWorkflowRun(inspectedRun);

/** What a contributed trigger kind asks a test run to start with, e.g. a sample call. */
const kindName = computed(() => draft.value?.trigger.kind ?? null);
const sample = computed(() => {
  const loader = kindName.value ? triggerKind(kindName.value).entry?.sample : undefined;
  return loader
    ? defineAsyncComponent(() => loader().then((module) => module.default as Component))
    : null;
});
const runStatuses = computed(() => (shownRun.value ? statusesOf(shownRun.value.log) : {}));
</script>

<template>
  <PageState :ready="Boolean(draft)" :loading="isLoading" :error="notFound ? null : loadError" :retry="refetch" :not-found="notFound" loading-label="Loading workflow..." not-found-title="Workflow not found" not-found-icon="workflow" back-to="/workflows" back-label="All workflows">
    <div v-if="draft" class="mb-page-wide">
      <EditorHeader :title="draft.name || 'Workflow'" eyebrow="Workflow">
        <template #badge>
          <StatusBadge
            v-if="isCode"
            status="code"
            :title="`Declared by ${declaredBy}. Edit it there, or clone it here.`"
          />
          <StatusBadge v-else-if="readOnly" status="read-only" />
          <StatusBadge v-else-if="isDirty" status="unsaved" />
          <StatusBadge v-if="liveVersion === null" status="draft" title="Not published: its trigger starts nothing yet" />
          <template v-else>
            <button type="button" class="mb-badge wf:font-mono wf:hover:underline" :title="`Version ${liveVersion} is live`" @click="tab = 'versions'">v{{ liveVersion }}</button>
            <StatusBadge v-if="data?.draftChanged" status="changed" title="The saved draft differs from the live version" />
          </template>
          <StatusBadge :status="draft.enabled ? 'on' : 'off'" />
        </template>
        <button v-if="canWrite" class="mb-btn-outline" :title="isCode ? 'Make an editable copy of this workflow' : 'Copy this workflow, switched off'" @click="actions.clone">
          <Icon name="copy" /> {{ isCode ? 'Clone' : 'Duplicate' }}
        </button>
        <button class="mb-btn-outline" title="Download as a JSON file to import elsewhere" @click="actions.exportFile">
          <Icon name="download" /> Export
        </button>
        <button v-if="startable" class="mb-btn-outline" :disabled="!data?.enabled" :title="data?.enabled ? 'Start the live version now' : 'Switch it on to run it'" @click="starting = true">
          <Icon name="play" /> Run
        </button>
        <button v-if="!readOnly" class="mb-btn-outline" :disabled="running || saving" title="Run the draft now with sample input and watch what it does. Its actions really happen." @click="actions.startRun">
          <Icon name="play" /> {{ running ? 'Running...' : 'Test run' }}
        </button>
        <SaveButton v-if="!readOnly" variant="outline" :saving="saving" :disabled="!isDirty" label="Save draft" @click="actions.save" />
        <button v-if="!readOnly" class="mb-btn-primary" :disabled="!canPublish || saving || publishing" title="Make the draft the version the trigger runs" @click="askingPublish = true">
          <Icon name="upload" /> Publish
        </button>
        <button v-if="!readOnly" class="mb-btn-ghost-danger" @click="actions.remove">
          <Icon name="trash" /> Delete
        </button>
      </EditorHeader>

      <div v-if="otherErrors.length" class="mb-callout wf:mb-4" role="alert">
        <p v-for="message in otherErrors" :key="message">{{ message }}</p>
      </div>

      <Tabs v-model="tab" class="wf:mb-4" :tabs="TABS" aria-label="Workflow" />

      <!-- Container query, since the side list takes width. The grid is a child: an element
           cannot query itself. -->
      <div v-if="tab === 'build'" class="wf:@container">
        <div class="wf:grid wf:min-h-0 wf:gap-4 wf:@4xl:grid-cols-[minmax(0,1fr)_19rem] wf:@6xl:grid-cols-[13rem_minmax(0,1fr)_19rem] wf:@[90rem]:grid-cols-[14rem_minmax(0,1fr)_22rem]">
          <aside v-if="!readOnly" class="mb-card wf:hidden wf:overflow-hidden wf:p-0 wf:@6xl:block">
            <NodePalette :catalog="catalog" @action="graph.addAction" @add="graph.addControl" />
          </aside>

          <div class="wf:min-w-0">
            <div class="wf:relative wf:h-[calc(100dvh-15rem)] wf:min-h-[30rem] wf:overflow-hidden wf:rounded-card wf:border wf:border-surface-200 wf:dark:border-surface-800">
              <WorkflowCanvas
                ref="canvas"
                :draft="draft"
                :actions="catalog?.actions ?? []"
                :read-only="readOnly"
                :selected-id="selectedId"
                :errors="errors"
                :run-statuses="runStatuses"
                :workflow-names="names"
                @update:nodes="draft.nodes = $event"
                @update:edges="draft.edges = $event"
                @select="selectedId = $event"
                @drop="graph.drop"
              />

              <div class="wf:pointer-events-none wf:absolute wf:top-2 wf:left-2 wf:flex wf:flex-wrap wf:items-center wf:gap-2">
                <DropdownMenu v-if="!readOnly" v-model:open="arranging" align="start" class="wf:w-64">
                  <template #trigger>
                    <button type="button" class="mb-btn-outline mb-btn-sm wf:pointer-events-auto wf:bg-surface-0/90 wf:dark:bg-surface-900/90">
                      <Icon name="grid" class="mb-icon-sm" /> Arrange
                      <Icon name="down" class="mb-icon-sm wf:opacity-60" />
                    </button>
                  </template>
                  <div>
                    <button type="button" class="mb-menu-item wf:flex wf:w-full wf:items-start wf:gap-2.5 wf:text-left" @click="arrange('compact')">
                      <Icon name="shrink" class="wf:mt-0.5 mb-icon wf:shrink-0 wf:text-brand-500" />
                      <span>
                        <span class="wf:block wf:font-medium">Compact</span>
                        <span class="wf:block mb-meta">Close together, branches share the space</span>
                      </span>
                    </button>
                    <button type="button" class="mb-menu-item wf:flex wf:w-full wf:items-start wf:gap-2.5 wf:text-left" @click="arrange('relaxed')">
                      <Icon name="expand" class="wf:mt-0.5 mb-icon wf:shrink-0 wf:text-brand-500" />
                      <span>
                        <span class="wf:block wf:font-medium">Relaxed</span>
                        <span class="wf:block mb-meta">More room, each branch in its own lane</span>
                      </span>
                    </button>
                  </div>
                </DropdownMenu>
                <span v-if="inspectedRun" class="mb-badge-brand wf:pointer-events-auto wf:gap-1">
                  Showing the test run
                  <RouterLink :to="`/workflows/${id}/runs/${inspectedRun}`" class="wf:font-semibold wf:underline" aria-label="Open the test run">Open</RouterLink>
                  <button type="button" class="wf:rounded-pill wf:hover:text-danger-600" aria-label="Stop showing the run" @click="inspectedRun = null"><Icon name="x" class="mb-icon-sm" /></button>
                </span>
              </div>

              <p v-if="!draft.nodes.length" class="wf:pointer-events-none wf:absolute wf:inset-x-0 wf:bottom-6 wf:text-center mb-meta">
                Click or drag what should happen from the palette, then join the nodes up.
              </p>
            </div>

            <!-- Palette row under the canvas when narrow. -->
            <div v-if="!readOnly" class="mb-card wf:mt-4 wf:max-h-96 wf:overflow-hidden wf:p-0 wf:@6xl:hidden">
              <NodePalette :catalog="catalog" @action="graph.addAction" @add="graph.addControl" />
            </div>
          </div>

          <aside class="wf:min-w-0 wf:space-y-4">
            <TriggerInspector
              v-if="selectedId === TRIGGER_ID"
              v-model:trigger="draft.trigger"
              v-model:abort-triggers="draft.abortTriggers"
              :space-id="spaces.currentId"
              :catalog="catalog"
              :read-only="readOnly"
              :error-for="fieldError"
            />

            <div v-else class="mb-card">
              <NodeInspector
                :draft="draft"
                :selected-id="selectedId"
                :space-id="spaces.currentId"
                :catalog="catalog"
                :read-only="readOnly"
                :error-for="fieldError"
                :self-id="id"
                @update:node="graph.updateNode"
                @update:edge="graph.updateEdge"
                @remove="graph.removeSelected"
              />
            </div>

            <div v-if="!selectedId" class="mb-card wf:space-y-4">
              <p class="mb-meta">
                Pick a node on the canvas to edit it, or the one at the top to change when this
                workflow starts.
              </p>
              <div class="mb-surface-inset wf:rounded-control wf:p-2.5 wf:text-xs">
                <template v-if="liveVersion !== null && data">
                  <p>
                    <span class="wf:font-semibold">Version {{ liveVersion }} is live</span>,
                    published <span :title="data.publishedAt ? formatDateTime(data.publishedAt) : ''">{{ data.publishedAt ? relativeTime(data.publishedAt) : '' }}</span>.
                  </p>
                  <p v-if="data.draftChanged || isDirty" class="wf:mt-0.5 wf:text-surface-500">You are editing the draft; publish it to make the changes live.</p>
                </template>
                <p v-else>
                  <span class="wf:font-semibold">Not published yet.</span>
                  <span class="wf:text-surface-500"> The trigger runs the published version, so publish the draft when it is ready. Test runs try it first.</span>
                </p>
                <button type="button" class="wf:mt-1 mb-link" @click="tab = 'versions'">See all versions</button>
              </div>
              <Switch
                :model-value="draft.enabled"
                :disabled="!canWrite"
                @update:model-value="actions.toggleEnabled"
              >
                <span class="wf:block wf:text-sm wf:font-bold">{{ draft.enabled ? 'Switched on' : 'Switched off' }}</span>
                <span class="wf:block wf:text-2xs wf:text-surface-500">
                  <template v-if="liveVersion === null">Publish it first: until then its trigger starts nothing.</template>
                  <template v-else-if="draft.enabled">Runs the live version when its trigger fires.</template>
                  <template v-else>Published, but does nothing until switched on.</template>
                </span>
              </Switch>
              <TextField id="workflow-name" v-model="draft.name" label="Name" :readonly="readOnly" :error="fieldError(['name'])" />
              <TextareaField
                id="workflow-description"
                v-model="draft.description"
                label="Description"
                rows="3"
                :readonly="readOnly"
                placeholder="What this is for, for the next person"
              />
            </div>
          </aside>
        </div>
      </div>

      <section v-else-if="tab === 'versions'" class="mb-card wf:min-w-0">
        <div class="wf:mb-2 wf:flex wf:flex-wrap wf:items-center wf:gap-2">
          <h2 class="wf:text-sm wf:font-bold">Versions</h2>
          <span class="mb-meta">Each publish is kept. The trigger runs the live one; runs finish on the version they started on.</span>
        </div>
        <VersionList
          :space-id="spaces.currentId"
          :workflow-id="id"
          :can-restore="!readOnly"
          :draft-changed="Boolean(data?.draftChanged)"
          @restore="actions.restore"
        />
      </section>

      <section v-else class="mb-card wf:min-w-0">
        <h2 class="wf:mb-2 wf:text-sm wf:font-bold">Run history</h2>
        <RunHistory :space-id="spaces.currentId" :workflow-id="id" :can-abort="canWrite" />
      </section>
    </div>

    <CallInputDialog
      v-if="asking === 'input' && (draft?.trigger.kind === 'call' || draft?.trigger.kind === 'manual')"
      :parameters="draft.trigger.parameters"
      @run="actions.runNow({ input: $event })"
      @close="asking = null"
    />
    <component
      :is="sample"
      v-if="asking === 'sample' && sample && draft"
      :trigger="draft.trigger"
      :run="(start: TestSample) => actions.runNow(start)"
      :close="() => (asking = null)"
    />
    <ContentPicker
      v-if="asking === 'document'"
      variant="dialog"
      label="Test it against which document?"
      :type-ids="draft?.trigger.kind === 'event' ? draft.trigger.typeIds : []"
      @pick="actions.runNow({ contentId: $event.id })"
      @close="asking = null"
    />
    <StartRunDialog v-if="starting && data && liveVersion !== null" :workflow-id="id" :name="data.name" :version="liveVersion" @close="starting = false" />
    <PublishDialog
      v-if="askingPublish && draft"
      :version="(liveVersion ?? 0) + 1"
      :enabled="draft.enabled"
      :unsaved="isDirty"
      :busy="publishing"
      @publish="actions.publish"
      @close="askingPublish = false"
    />
  </PageState>
</template>
