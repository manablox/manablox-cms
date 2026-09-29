<script setup lang="ts">
import { type ErrorFor } from '@manablox/admin-sdk';
import type { WorkflowEdge } from '../../../sdk';
import type { PlaceholderHint } from '../../model';
import type { WorkflowCatalog } from '../../queries';
import GuardedRules from '../GuardedRules.vue';

/** The rules that make a connection conditional. */
const props = defineProps<{
  edge: WorkflowEdge;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  /** What the edge's source node offers. */
  hints: PlaceholderHint[];
  /** Errors under the guard. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [edge: WorkflowEdge] }>();
</script>

<template>
  <GuardedRules
    :model-value="edge.guard"
    title="Only take this line sometimes"
    hint="A quick fork without a node of its own."
    lead="Take this line if"
    field="content.status"
    value="published"
    :read-only="readOnly"
    :hints="hints"
    :catalog="catalog"
    :error-for="errorFor"
    @update:model-value="emit('update', { ...props.edge, guard: $event })"
  />
</template>
