<script setup lang="ts">
import { CheckCard, type ErrorFor } from '@manablox/admin-sdk';
import type { WorkflowRuleSet } from '../../sdk';
import { newRuleSet, type PlaceholderHint } from '../model';
import type { WorkflowCatalog } from '../queries';
import RuleList from './RuleList.vue';

/** An optional rule set behind a checkbox; ticking it starts one rule on `field`. */
const model = defineModel<WorkflowRuleSet | null>({ required: true });
withDefaults(
  defineProps<{
    title: string;
    hint: string;
    /** The clause before the rules. */
    lead: string;
    field: string;
    /** The first rule's comparand. */
    value?: string;
    readOnly: boolean;
    hints: PlaceholderHint[];
    catalog: WorkflowCatalog | undefined;
    /** Errors by path under the rule set. */
    errorFor: ErrorFor;
  }>(),
  { value: '' },
);
</script>

<template>
  <div class="wf:rounded-card wf:border wf:border-surface-200 wf:p-3 wf:dark:border-surface-800">
    <CheckCard
      :model-value="model !== null"
      :title="title"
      :hint="hint"
      :disabled="readOnly"
      @update:model-value="model = $event ? newRuleSet(field, value) : null"
    />
    <div v-if="model" class="wf:mt-3 wf:border-t wf:border-surface-200 wf:pt-3 wf:dark:border-surface-800">
      <RuleList
        :match="model.match"
        :rules="model.rules"
        :lead="lead"
        :read-only="readOnly"
        :hints="hints"
        :catalog="catalog"
        :error-for="errorFor"
        @update="model = { ...model, ...$event }"
      />
    </div>
  </div>
</template>
