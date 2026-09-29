<script setup lang="ts">
import { Icon, IconButton, Select, TextField } from '@manablox/admin-sdk';
import { computed } from 'vue';
import {
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_UNARY_OPERATORS,
  type WorkflowConditionRule,
} from '../../sdk';
import type { PlaceholderHint } from '../model';
import type { WorkflowCatalog } from '../queries';
import PlaceholderComplete from './PlaceholderComplete.vue';
import PlaceholderHelp from './PlaceholderHelp.vue';

/** A condition's or fork's rules: value, operator, comparand. */
const props = defineProps<{
  match: 'all' | 'any';
  rules: WorkflowConditionRule[];
  /** The clause before the rules: "Continue only if", "Take the yes side if". */
  lead: string;
  readOnly: boolean;
  hints: PlaceholderHint[];
  catalog: WorkflowCatalog | undefined;
  errorFor: (path: (string | number)[]) => string | null;
}>();
const emit = defineEmits<{
  update: [patch: { match?: 'all' | 'any'; rules?: WorkflowConditionRule[] }];
}>();

const operators = computed(() =>
  (props.catalog?.operators ?? []).map((op) => ({ value: op.id, label: op.label })),
);
const MATCH_OPTIONS = [
  { value: 'all', label: 'all of these' },
  { value: 'any', label: 'any of these' },
] as const;

/** Common paths suggested under the field input. */
const fieldSuggestions = computed(() =>
  props.hints.map((hint) => hint.path).filter((path) => !path.includes('<')),
);
const listId = `rule-fields-${Math.random().toString(36).slice(2)}`;

function patchRule(index: number, patch: Partial<WorkflowConditionRule>) {
  emit('update', {
    rules: props.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
  });
}
function setOperator(index: number, value: string) {
  const operator = WORKFLOW_CONDITION_OPERATORS.find((known) => known === value);
  if (operator) patchRule(index, { operator });
}
function addRule() {
  emit('update', {
    rules: [...props.rules, { field: 'content.status', operator: 'equals', value: '' }],
  });
}
function removeRule(index: number) {
  emit('update', { rules: props.rules.filter((_, i) => i !== index) });
}
</script>

<template>
  <!-- Container query: the list appears at different widths. -->
  <PlaceholderComplete :hints="hints" class="wf:@container wf:space-y-3">
    <div class="wf:flex wf:flex-wrap wf:items-center wf:gap-2 wf:text-sm">
      <span>{{ lead }}</span>
      <Select
        :model-value="match"
        :options="MATCH_OPTIONS"
        variant="sm"
        :disabled="readOnly"
        aria-label="How rules combine"
        @update:model-value="emit('update', { match: $event })"
      />
      <span>hold:</span>
      <span class="wf:flex-1" />
      <PlaceholderHelp :hints="hints" />
    </div>

    <datalist :id="listId">
      <option v-for="path in fieldSuggestions" :key="path" :value="path" />
    </datalist>

    <div class="wf:space-y-1.5">
      <div v-for="(rule, index) in rules" :key="index" class="wf:grid wf:grid-cols-[minmax(0,1fr)_auto] wf:items-start wf:gap-1.5 wf:@xl:grid-cols-[minmax(0,1fr)_11rem_minmax(0,1fr)_auto]">
        <TextField
          :model-value="rule.field"
          field-class="wf:min-w-0"
          class="mb-input-mono"
          :list="listId"
          placeholder="content.fields.category"
          :readonly="readOnly"
          :aria-label="`Rule ${index + 1}: value`"
          :error="errorFor(['rules', index, 'field'])"
          @update:model-value="patchRule(index, { field: String($event ?? '') })"
        />
        <div class="wf:col-span-2 wf:@xl:col-span-1">
          <Select
            :model-value="rule.operator"
            :options="operators"
            :disabled="readOnly"
            :aria-label="`Rule ${index + 1}: operator`"
            @update:model-value="setOperator(index, $event)"
          />
        </div>
        <TextField
          v-if="!WORKFLOW_UNARY_OPERATORS.includes(rule.operator)"
          :model-value="rule.value"
          field-class="wf:col-span-2 wf:min-w-0 wf:@xl:col-span-1"
          placeholder="value, or {{ a.path }}"
          :readonly="readOnly"
          :aria-label="`Rule ${index + 1}: expected`"
          @update:model-value="patchRule(index, { value: String($event ?? '') })"
        />
        <IconButton v-if="!readOnly" icon="x" label="Remove rule" size="md" class="wf:col-start-2 wf:row-start-1 wf:@xl:col-start-4" @click="removeRule(index)" />
      </div>
    </div>
    <p v-if="errorFor(['rules'])" class="mb-error">{{ errorFor(['rules']) }}</p>
    <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" @click="addRule"><Icon name="plus" class="mb-icon-sm" /> Add rule</button>
  </PlaceholderComplete>
</template>
