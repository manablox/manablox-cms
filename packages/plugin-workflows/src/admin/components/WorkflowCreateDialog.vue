<script setup lang="ts">
import {
  FeatureLock,
  FormDialog,
  FormField,
  SegmentedControl,
  TextField,
  toast,
  useDraftForm,
  useSlotEntries,
} from '@manablox/admin-sdk';
import type { FeatureKey } from '@manablox/core';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { WORKFLOW_TRIGGER_ID } from '../../sdk';
import {
  CONTROL_NODES,
  kindOptions,
  newEdge,
  spotUnder,
  useTriggerKinds,
  type WorkflowDesign,
} from '../model';
import { designWorkflow, useWorkflowCatalog, workflows } from '../queries';
import type { WorkflowCreateActionProps, WorkflowTriggerValue } from '../slots';
import WorkflowDesignPreview from './WorkflowDesignPreview.vue';

/**
 * Creates a workflow (disabled, with one node) from a name and trigger kind, then opens the
 * editor. Other plugins add ways to start one (`workflows:createActions`), e.g. describing it.
 */
const props = defineProps<{
  spaceId: string;
  /** Preselects this trigger kind, pointed at `preset`, e.g. an incoming endpoint. */
  kind?: string | null;
  preset?: string | null;
}>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const form = useDraftForm<{ name: string }>();
form.load({ name: '' });
const draft = form.draft;

const { data: catalog } = useWorkflowCatalog(() => props.spaceId);
const kinds = useTriggerKinds(catalog);
const KINDS = computed(() => kindOptions(kinds.list.value));
const kind = ref<string>(props.kind ?? 'event');
/** The trigger as the picked kind's form in the dialog left it. */
const trigger = ref<WorkflowTriggerValue>(kinds.of(kind.value).create(props.preset ?? null));
watch(kind, (next) => {
  trigger.value = kinds.of(next).create(null);
});
const current = computed(() => kinds.of(kind.value));

/** Other ways to start: a pane per entry, next to building it by hand; a lock while locked. */
const entries = useSlotEntries('workflows:createActions', { locked: true });
const actions = computed(() => entries.value.filter((item) => !item.locked));
const lockedActions = computed(() => entries.value.filter((item) => item.locked));
const mode = ref('build');
const MODES = computed(() => [
  { value: 'build', label: 'Build it', icon: 'workflow' },
  ...actions.value.map((item) => ({
    value: item.key,
    label: item.label ?? item.key,
    icon: item.icon ?? 'zap',
  })),
]);
const action = computed(() => actions.value.find((item) => item.key === mode.value) ?? null);

/** A designed workflow, validated and previewed before it is created. */
const design = ref<WorkflowDesign | null>(null);
const designFailed = ref(false);

const actionProps = computed<WorkflowCreateActionProps>(() => ({
  spaceId: props.spaceId,
  designed: Boolean(design.value),
  async design(input) {
    const designed = await designWorkflow(props.spaceId, input);
    design.value = designed;
    if (draft.value) draft.value.name = designed.name;
  },
}));

const name = computed(() => draft.value?.name.trim() ?? '');
const triggerErrors = (path: (string | number)[]) => form.fieldError(['trigger', ...path]);

/** Everything a workflow needs before it can be created at all. */
const ready = computed(() =>
  action.value
    ? Boolean(design.value && name.value)
    : Boolean(name.value) && (current.value.entry?.ready?.(trigger.value) ?? true),
);

/** The designed workflow, or one of the picked kind with a single condition to start from. */
function plan() {
  if (action.value && design.value) {
    const { description, trigger: designed, nodes, edges } = design.value;
    return { ...(description ? { description } : {}), trigger: designed, nodes, edges };
  }
  const start = CONTROL_NODES.condition.create(spotUnder([], null, 'out'), []);
  return {
    trigger: trigger.value as never,
    // A workflow needs at least one node to save.
    nodes: [start],
    edges: [newEdge(WORKFLOW_TRIGGER_ID, 'out', start.id)],
  };
}

async function create() {
  if (!ready.value) return false;
  const result: { created?: { id: string; name: string } } = {};
  designFailed.value = false;
  const ok = await form.submit(async () => {
    result.created = await workflows.create({
      spaceId: props.spaceId,
      name: name.value,
      enabled: false,
      ...plan(),
    });
  });
  if (!ok || !result.created) {
    designFailed.value = Boolean(action.value);
    return false;
  }
  toast.success(`Created "${result.created.name}"`);
  await router.push(`/workflows/${result.created.id}`);
  return true;
}
</script>

<template>
  <FormDialog
    v-if="draft"
    title="New workflow"
    :width="action ? 'max-w-2xl' : undefined"
    form-class="wf:space-y-5"
    submit-label="Create workflow"
    busy-label="Creating..."
    :busy="form.saving.value"
    :disabled="!ready"
    @submit="create"
    @close="emit('close')"
  >
    <SegmentedControl v-if="actions.length" v-model="mode" :options="MODES" :columns="Math.min(MODES.length, 3)" aria-label="How to start" />
    <div v-if="lockedActions.length" class="wf:flex wf:flex-wrap wf:gap-2">
      <FeatureLock
        v-for="item in lockedActions"
        :key="item.key"
        :feature="item.feature as FeatureKey"
        :label="item.label ?? item.key"
      />
    </div>

    <template v-if="action">
      <component :is="action.component" v-bind="actionProps" />
      <WorkflowDesignPreview
        v-if="design"
        v-model:name="draft.name"
        :design="design"
        :catalog="catalog"
        :name-error="form.fieldError(['name'])"
      />
      <p v-if="designFailed" class="mb-callout" role="status">
        The design does not save as it is. Describe it again - more precisely where it went wrong - or build it by hand.
      </p>
    </template>

    <template v-else>
      <TextField v-model="draft.name" label="Name" placeholder="Notify the editors" required :error="form.fieldError(['name'])" />

      <FormField label="Starts" :hint="current.hint">
        <template #default="{ id }">
          <SegmentedControl
            :id="id"
            v-model="kind"
            class="wf:w-full"
            :options="KINDS"
            :columns="1"
            aria-label="What starts the workflow"
          />
        </template>
      </FormField>

      <component
        :is="current.item.component"
        v-if="current.item"
        :trigger="trigger"
        mode="create"
        :space-id="spaceId"
        :catalog="catalog?.triggers[kind]"
        :read-only="false"
        :error-for="triggerErrors"
        :update="(next: WorkflowTriggerValue) => (trigger = next)"
      />
    </template>
  </FormDialog>
</template>
