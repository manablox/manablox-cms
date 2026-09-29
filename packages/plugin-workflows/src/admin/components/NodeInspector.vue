<script setup lang="ts">
import {
  CredentialPicker,
  type ErrorFor,
  FeatureLock,
  Icon,
  IconButton,
  Switch,
  scoped,
  TextField,
  useSessionStore,
  useSlotEntries,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import type {
  WorkflowActionNode,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeBase,
  WorkflowRuleSet,
} from '../../sdk';
import {
  actionFeature,
  CONTROL_NODES,
  type Draft,
  hintsFor,
  nodeLabel,
  untilHintsFor,
} from '../model';
import type { WorkflowCatalog } from '../queries';
import FieldForm from './FieldForm.vue';
import CallNodeForm from './node/CallNodeForm.vue';
import DelayNodeForm from './node/DelayNodeForm.vue';
import EdgeGuardForm from './node/EdgeGuardForm.vue';
import LoopNodeForm from './node/LoopNodeForm.vue';
import StopNodeForm from './node/StopNodeForm.vue';
import SwitchNodeForm from './node/SwitchNodeForm.vue';
import PlaceholderComplete from './PlaceholderComplete.vue';
import RuleList from './RuleList.vue';

/** Settings for the selection: a node and its action form, or an edge's guard. */
const props = defineProps<{
  draft: Draft;
  selectedId: string | null;
  spaceId: string | null;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  errorFor: ErrorFor;
  /** The workflow being edited, which its own call nodes may not pick. */
  selfId?: string | undefined;
}>();
const emit = defineEmits<{
  'update:node': [node: WorkflowNode];
  'update:edge': [edge: WorkflowEdge];
  remove: [];
}>();

const index = computed(() => props.draft.nodes.findIndex((entry) => entry.id === props.selectedId));
const node = computed(() => props.draft.nodes[index.value] ?? null);
const edgeIndex = computed(() =>
  props.draft.edges.findIndex((entry) => entry.id === props.selectedId),
);
const edge = computed(() => props.draft.edges[edgeIndex.value] ?? null);

const nodeErrors = computed(() => scoped(props.errorFor, ['nodes', index.value]));
const guardErrors = computed(() => scoped(props.errorFor, ['edges', edgeIndex.value, 'guard']));

const actions = computed(() => props.catalog?.actions ?? []);

const meta = computed(() => {
  const current = node.value;
  if (current?.kind !== 'action') return null;
  return actions.value.find((action) => action.type === current.action) ?? null;
});

const session = useSessionStore();
const spaces = useSpaceStore();
/** The flag of an action node while it is off; the node cannot be switched on then. */
const locked = computed(() => {
  const current = node.value;
  const key = current?.kind === 'action' ? actionFeature(current.action, meta.value) : null;
  if (!key) return null;
  const state = session.feature(key, spaces.currentId);
  return state.enabled ? null : { key, state };
});

const hints = computed(() => hintsFor(props.draft, props.selectedId, actions.value));
const untilHints = computed(() =>
  node.value?.kind === 'loop' ? untilHintsFor(props.draft, node.value, actions.value) : [],
);
/** Guard hints come from the edge's source node. */
const edgeHints = computed(() => hintsFor(props.draft, edge.value?.from ?? null, actions.value));

/** The action's description, or the control node's. */
const description = computed(() => {
  const current = node.value;
  if (!current) return '';
  return current.kind === 'action'
    ? (meta.value?.description ?? '')
    : CONTROL_NODES[current.kind].description;
});

/** A plugin's own action form (`workflows:nodeForm`), if it ships one; else the generic form. */
const forms = useSlotEntries('workflows:nodeForm');
const custom = computed(() => {
  const current = node.value;
  if (current?.kind !== 'action') return null;
  return (
    forms.value.find((item) => (item.entry as { action?: string }).action === current.action)
      ?.component ?? null
  );
});

/** Fields every node kind has. */
function patch(
  change: Partial<Pick<WorkflowNodeBase, 'name' | 'key' | 'enabled' | 'continueOnError' | 'join'>>,
) {
  if (node.value) emit('update:node', { ...node.value, ...change });
}

function patchAction(change: Partial<WorkflowActionNode>) {
  const current = node.value;
  if (current?.kind === 'action') emit('update:node', { ...current, ...change });
}

function patchCondition(change: Partial<WorkflowRuleSet>) {
  const current = node.value;
  if (current?.kind === 'condition') emit('update:node', { ...current, ...change });
}

const edgeEnds = computed(() => {
  if (!edge.value) return null;
  const from = props.draft.nodes.find((entry) => entry.id === edge.value?.from);
  const to = props.draft.nodes.find((entry) => entry.id === edge.value?.to);
  return {
    from: from ? nodeLabel(from, actions.value) : 'When this happens',
    to: to ? nodeLabel(to, actions.value) : '',
    port: edge.value.fromPort,
  };
});
</script>

<template>
  <div v-if="node" class="wf:space-y-5">
    <header class="wf:flex wf:items-start wf:justify-between wf:gap-2">
      <div class="wf:min-w-0">
        <h3 class="wf:truncate wf:text-sm wf:font-semibold">{{ nodeLabel(node, actions) }}</h3>
        <p class="wf:truncate mb-meta">{{ description }}</p>
      </div>
      <IconButton v-if="!readOnly" icon="trash" label="Remove this node" danger @click="emit('remove')" />
    </header>

    <p v-if="meta && !meta.available" class="mb-callout wf:text-xs">{{ meta.unavailable }}</p>
    <p v-if="locked && node.enabled" class="mb-callout wf:text-xs">This action is switched off here. Switch the node off or remove it to save the workflow.</p>

    <div class="wf:grid wf:gap-4 wf:sm:grid-cols-2">
      <TextField
        label="Name"
        :model-value="node.name"
        :placeholder="nodeLabel({ ...node, name: '' }, actions)"
        :readonly="readOnly"
        :error="nodeErrors(['name'])"
        @update:model-value="patch({ name: String($event ?? '') })"
      />
      <TextField
        label="Called in templates"
        :model-value="node.key"
        class="mb-input-mono"
        :readonly="readOnly"
        :error="nodeErrors(['key'])"
        @update:model-value="patch({ key: String($event ?? '') })"
      >
        <template #hint>
          <p class="wf:mt-1 mb-meta">Later nodes read this one's result as <span class="wf:font-mono">nodes.{{ node.key }}</span>.</p>
        </template>
      </TextField>
    </div>

    <template v-if="node.kind === 'action'">
      <PlaceholderComplete v-if="custom" :hints="hints">
        <component
          :is="custom"
          :config="node.config"
          :read-only="readOnly"
          :hints="hints"
          :update="(config: Record<string, unknown>) => patchAction({ config })"
        />
      </PlaceholderComplete>
      <FieldForm
        v-else-if="meta"
        :fields="meta.fields"
        :config="node.config"
        :read-only="readOnly"
        :hints="hints"
        :catalog="catalog"
        :id-prefix="`node-${node.id}`"
        :error-for="nodeErrors"
        @update="patchAction({ config: $event })"
      />
      <p v-else class="mb-callout wf:text-xs">
        No action named <span class="wf:font-mono">{{ node.action }}</span> is installed here. The node is kept, but the workflow cannot be saved until it is removed or the plugin is installed.
      </p>

      <CredentialPicker
        v-if="meta?.credential"
        :model-value="node.credentialId"
        :kinds="meta.credential.kinds"
        :space-id="spaceId"
        :optional="!meta.credential.required"
        :read-only="readOnly"
        :error="nodeErrors(['credentialId'])"
        @update:model-value="patchAction({ credentialId: $event })"
      />
    </template>

    <RuleList
      v-else-if="node.kind === 'condition'"
      :match="node.match"
      :rules="node.rules"
      lead="Take the yes side if"
      :read-only="readOnly"
      :hints="hints"
      :catalog="catalog"
      :error-for="nodeErrors"
      @update="patchCondition($event)"
    />

    <DelayNodeForm v-else-if="node.kind === 'delay'" :node="node" :read-only="readOnly" :error-for="nodeErrors" @update="emit('update:node', $event)" />
    <CallNodeForm v-else-if="node.kind === 'call'" :node="node" :catalog="catalog" :read-only="readOnly" :hints="hints" :error-for="nodeErrors" :self-id="selfId" @update="emit('update:node', $event)" />
    <SwitchNodeForm v-else-if="node.kind === 'switch'" :node="node" :catalog="catalog" :read-only="readOnly" :hints="hints" :error-for="nodeErrors" @update="emit('update:node', $event)" />
    <LoopNodeForm v-else-if="node.kind === 'loop'" :node="node" :catalog="catalog" :read-only="readOnly" :hints="hints" :until-hints="untilHints" :error-for="nodeErrors" @update="emit('update:node', $event)" />
    <StopNodeForm v-else-if="node.kind === 'stop'" :node="node" :read-only="readOnly" :hints="hints" :error-for="nodeErrors" @update="emit('update:node', $event)" />

    <div class="wf:space-y-3 wf:border-t wf:border-surface-200 wf:pt-4 wf:dark:border-surface-800">
      <div v-if="locked && !node.enabled" class="wf:flex wf:flex-wrap wf:items-center wf:gap-2">
        <Switch :model-value="false" disabled>
          <span class="wf:text-sm">Run this node</span>
        </Switch>
        <FeatureLock :feature="locked.key" :state="locked.state" />
      </div>
      <Switch v-else :model-value="node.enabled" :disabled="readOnly" @update:model-value="patch({ enabled: $event })">
        <span class="wf:text-sm">Run this node</span>
      </Switch>
      <Switch v-if="node.kind === 'action' || node.kind === 'call'" :model-value="node.continueOnError" :disabled="readOnly" @update:model-value="patch({ continueOnError: $event })">
        <span class="wf:text-sm">Carry on if it fails</span>
        <span class="wf:block mb-meta">Without this, a failure ends the run - unless you draw a line from its "Failed" port.</span>
      </Switch>
      <Switch v-if="node.kind === 'loop'" :model-value="node.continueOnError" :disabled="readOnly" @update:model-value="patch({ continueOnError: $event })">
        <span class="wf:text-sm">Skip a pass that fails</span>
        <span class="wf:block mb-meta">Without this, a failure in any pass ends the run.</span>
      </Switch>
      <Switch :model-value="node.join === 'all'" :disabled="readOnly" @update:model-value="patch({ join: $event ? 'all' : 'any' })">
        <span class="wf:text-sm">Wait for every incoming line</span>
        <span class="wf:block mb-meta">For a node where two branches meet. Otherwise the first line to arrive starts it.</span>
      </Switch>
    </div>
  </div>

  <div v-else-if="edge && edgeEnds" class="wf:space-y-5">
    <header class="wf:flex wf:items-start wf:justify-between wf:gap-2">
      <div class="wf:min-w-0">
        <h3 class="wf:text-sm wf:font-semibold">A connection</h3>
        <p class="mb-meta">
          {{ edgeEnds.from }} <span class="wf:font-mono">({{ edgeEnds.port }})</span> to {{ edgeEnds.to }}
        </p>
      </div>
      <IconButton v-if="!readOnly" icon="trash" label="Remove this connection" danger @click="emit('remove')" />
    </header>

    <EdgeGuardForm :edge="edge" :catalog="catalog" :read-only="readOnly" :hints="edgeHints" :error-for="guardErrors" @update="emit('update:edge', $event)" />
  </div>

  <div v-else class="wf:py-10 wf:text-center">
    <Icon name="workflow" class="wf:mx-auto wf:h-8 wf:w-8 wf:text-surface-300 wf:dark:text-surface-700" />
    <p class="wf:mt-2 wf:text-sm wf:text-surface-500">Pick a node to edit it,</p>
    <p class="wf:text-sm wf:text-surface-500">or add one from the palette.</p>
  </div>
</template>
