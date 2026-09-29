<script setup lang="ts">
import { type ErrorFor, Icon, IconButton, Select, TextField } from '@manablox/admin-sdk';
import { computed } from 'vue';
import {
  switchCaseLabel,
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_MAX_SWITCH_CASES,
  WORKFLOW_UNARY_OPERATORS,
  type WorkflowNodeOf,
  type WorkflowSwitchCase,
} from '../../../sdk';
import type { PlaceholderHint } from '../../model';
import type { WorkflowCatalog } from '../../queries';
import PlaceholderComplete from '../PlaceholderComplete.vue';
import PlaceholderHelp from '../PlaceholderHelp.vue';

type SwitchNode = WorkflowNodeOf<'switch'>;

/** The value a switch compares, and its cases in the order they are tried. */
const props = defineProps<{
  node: SwitchNode;
  readOnly: boolean;
  hints: PlaceholderHint[];
  catalog: WorkflowCatalog | undefined;
  /** Errors under the node. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [node: SwitchNode] }>();

const patch = (change: Partial<SwitchNode>) => emit('update', { ...props.node, ...change });

const operators = computed(() =>
  (props.catalog?.operators ?? []).map((op) => ({ value: op.id, label: op.label })),
);
const fieldSuggestions = computed(() =>
  props.hints.map((hint) => hint.path).filter((path) => !path.includes('<')),
);
const listId = `switch-fields-${Math.random().toString(36).slice(2)}`;

function patchCase(index: number, change: Partial<WorkflowSwitchCase>) {
  patch({
    cases: props.node.cases.map((entry, i) => (i === index ? { ...entry, ...change } : entry)),
  });
}
function setOperator(index: number, value: string) {
  const operator = WORKFLOW_CONDITION_OPERATORS.find((known) => known === value);
  if (operator) patchCase(index, { operator });
}
/** A new case gets the next port name nothing uses, so no line jumps to it. */
function addCase() {
  const taken = new Set(props.node.cases.map((entry) => entry.id));
  let n = props.node.cases.length + 1;
  while (taken.has(`case_${n}`)) n++;
  patch({
    cases: [...props.node.cases, { id: `case_${n}`, label: '', operator: 'equals', value: '' }],
  });
}
function removeCase(index: number) {
  patch({ cases: props.node.cases.filter((_, i) => i !== index) });
}
function moveCase(index: number, by: -1 | 1) {
  const cases = [...props.node.cases];
  const [entry] = cases.splice(index, 1);
  if (!entry) return;
  cases.splice(index + by, 0, entry);
  patch({ cases });
}
</script>

<template>
  <PlaceholderComplete :hints="hints" class="wf:@container wf:space-y-4">
    <datalist :id="listId">
      <option v-for="path in fieldSuggestions" :key="path" :value="path" />
    </datalist>
    <TextField
      label="Compare"
      :model-value="node.field"
      class="mb-input-mono"
      :list="listId"
      placeholder="content.fields.category"
      :readonly="readOnly"
      :error="errorFor(['field'])"
      @update:model-value="patch({ field: String($event ?? '') })"
    >
      <template #actions><PlaceholderHelp :hints="hints" /></template>
      <template #hint>
        <p class="wf:mt-1 mb-meta">A path into the run. The cases are tried from the top; the first that holds is taken.</p>
      </template>
    </TextField>

    <div class="wf:space-y-2">
      <div
        v-for="(entry, index) in node.cases"
        :key="entry.id"
        class="wf:space-y-1.5 wf:rounded-control wf:border wf:border-surface-200 wf:p-2 wf:dark:border-surface-800"
      >
        <div class="wf:flex wf:items-center wf:gap-1.5">
          <span class="wf:min-w-0 wf:flex-1 wf:truncate wf:text-xs wf:font-medium wf:text-surface-600 wf:dark:text-surface-300">
            {{ index + 1 }}. {{ switchCaseLabel(entry) || 'New case' }}
            <span class="wf:font-mono wf:text-surface-400">({{ entry.id }})</span>
          </span>
          <template v-if="!readOnly">
            <IconButton icon="up" :label="`Move case ${index + 1} up`" :disabled="index === 0" @click="moveCase(index, -1)" />
            <IconButton icon="down" :label="`Move case ${index + 1} down`" :disabled="index === node.cases.length - 1" @click="moveCase(index, 1)" />
            <IconButton icon="x" :label="`Remove case ${index + 1}`" @click="removeCase(index)" />
          </template>
        </div>
        <div class="wf:grid wf:grid-cols-1 wf:gap-1.5 wf:@md:grid-cols-[11rem_minmax(0,1fr)]">
          <Select
            :model-value="entry.operator"
            :options="operators"
            :disabled="readOnly"
            :aria-label="`Case ${index + 1}: operator`"
            @update:model-value="setOperator(index, $event)"
          />
          <TextField
            v-if="!WORKFLOW_UNARY_OPERATORS.includes(entry.operator)"
            :model-value="entry.value"
            field-class="wf:min-w-0"
            placeholder="value, or {{ a.path }}"
            :readonly="readOnly"
            :aria-label="`Case ${index + 1}: value`"
            :error="errorFor(['cases', index, 'value'])"
            @update:model-value="patchCase(index, { value: String($event ?? '') })"
          />
        </div>
        <TextField
          :model-value="entry.label"
          :placeholder="`Canvas label: ${switchCaseLabel({ ...entry, label: '' })}`"
          :readonly="readOnly"
          :aria-label="`Case ${index + 1}: label on the canvas`"
          :error="errorFor(['cases', index, 'id']) ?? errorFor(['cases', index, 'operator'])"
          @update:model-value="patchCase(index, { label: String($event ?? '') })"
        />
      </div>
    </div>
    <p v-if="errorFor(['cases'])" class="mb-error">{{ errorFor(['cases']) }}</p>
    <div class="wf:flex wf:items-center wf:justify-between wf:gap-2">
      <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" :disabled="node.cases.length >= WORKFLOW_MAX_SWITCH_CASES" @click="addCase"><Icon name="plus" class="mb-icon-sm" /> Add case</button>
      <span class="mb-meta">When none holds, the run goes on by "Otherwise".</span>
    </div>
  </PlaceholderComplete>
</template>
