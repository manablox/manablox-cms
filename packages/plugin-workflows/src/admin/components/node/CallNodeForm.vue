<script setup lang="ts">
import {
  type ErrorFor,
  FormField,
  Icon,
  Select,
  type SelectOption,
  Switch,
  TextField,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import type { WorkflowNodeOf } from '../../../sdk';
import type { PlaceholderHint } from '../../model';
import type { WorkflowCatalog } from '../../queries';
import PlaceholderComplete from '../PlaceholderComplete.vue';
import PlaceholderHelp from '../PlaceholderHelp.vue';

type Call = WorkflowNodeOf<'call'>;

/** Which workflow a call node runs, with what values, and whether it waits. */
const props = defineProps<{
  node: Call;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  hints: PlaceholderHint[];
  /** Errors under the node. */
  errorFor: ErrorFor;
  /** The workflow being edited, which may not call itself. */
  selfId?: string | undefined;
}>();
const emit = defineEmits<{ update: [node: Call] }>();

const patch = (change: Partial<Call>) => emit('update', { ...props.node, ...change });

/** Workflows that start "When run by a workflow". */
const callable = computed(() =>
  (props.catalog?.callable ?? []).filter((entry) => entry.id !== props.selfId),
);

const options = computed((): SelectOption<string | null>[] => [
  {
    value: null,
    label: callable.value.length ? 'Choose a workflow' : 'No workflow can be run yet',
  },
  ...callable.value.map((entry) => ({
    value: entry.id,
    label: entry.enabled ? entry.name : `${entry.name} (switched off)`,
  })),
]);

const target = computed(
  () => props.catalog?.callable.find((entry) => entry.id === props.node.workflowId) ?? null,
);

/** Values set for names the target no longer takes. */
const strayInputs = computed(() => {
  if (!target.value) return [];
  const names = new Set(target.value.parameters.map((parameter) => parameter.name));
  return props.node.input.filter((row) => !names.has(row.name));
});

const inputValue = (name: string) => props.node.input.find((row) => row.name === name)?.value ?? '';

function setInput(name: string, value: string) {
  const others = props.node.input.filter((row) => row.name !== name);
  patch({ input: value ? [...others, { name, value }] : others });
}
</script>

<template>
  <PlaceholderComplete :hints="hints" class="wf:space-y-4">
    <FormField label="Workflow to run" :error="errorFor(['workflowId'])" v-slot="{ id }">
      <!-- A new target starts with a blank value per parameter it takes. -->
      <Select
        :id="id"
        :model-value="node.workflowId ?? null"
        :options="options"
        :disabled="readOnly"
        @update:model-value="patch({ workflowId: $event, input: [] })"
      />
    </FormField>
    <p v-if="!callable.length" class="mb-meta">
      Set another workflow to start "When run by a workflow" and it shows up here.
    </p>
    <div v-if="target" class="wf:flex wf:items-baseline wf:justify-between wf:gap-2">
      <p class="mb-meta">
        <template v-if="!target.enabled">It is switched off, so this node fails until it is on.</template>
        <template v-else-if="!target.parameters.length">It takes no values.</template>
        <template v-else>It takes {{ target.parameters.length === 1 ? 'one value' : `${target.parameters.length} values` }}.</template>
      </p>
      <RouterLink :to="`/workflows/${target.id}`" class="mb-btn-ghost mb-btn-sm wf:-my-1 wf:shrink-0" :aria-label="`Open ${target.name}`">
        <Icon name="external" class="mb-icon-sm" /> Open
      </RouterLink>
    </div>

    <TextField
      v-for="parameter in target?.parameters ?? []"
      :key="parameter.name"
      :label="parameter.required ? `${parameter.name} (required)` : parameter.name"
      :model-value="inputValue(parameter.name)"
      class="wf:font-mono wf:text-xs"
      :placeholder="parameter.description || '{{ content.id }}'"
      :readonly="readOnly"
      @update:model-value="setInput(parameter.name, String($event ?? ''))"
    >
      <template #actions><PlaceholderHelp :hints="hints" /></template>
      <template v-if="parameter.description" #hint>
        <p class="wf:mt-1 mb-meta">{{ parameter.description }}</p>
      </template>
    </TextField>
    <p v-if="errorFor(['input'])" class="mb-error">{{ errorFor(['input']) }}</p>
    <div v-if="strayInputs.length" class="mb-callout wf:text-xs">
      <p>It no longer takes {{ strayInputs.map((row) => row.name).join(', ') }}.</p>
      <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm wf:mt-1" @click="patch({ input: node.input.filter((row) => !strayInputs.includes(row)) })">
        <Icon name="x" class="mb-icon-sm" /> Drop them
      </button>
    </div>

    <Switch :model-value="node.wait" :disabled="readOnly" @update:model-value="patch({ wait: $event })">
      <span class="wf:text-sm">Wait for it to finish</span>
      <span class="wf:block mb-meta">
        {{ node.wait
          ? `What it hands back is read as nodes.${node.key}.output. If it waits at a delay, this run waits with it.`
          : 'It is started and this run carries on at once, without its result.' }}
      </span>
    </Switch>
  </PlaceholderComplete>
</template>
