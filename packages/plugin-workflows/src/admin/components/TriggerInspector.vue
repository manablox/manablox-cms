<script setup lang="ts">
import { type ErrorFor } from '@manablox/admin-sdk';
import type { WorkflowAbortTrigger, WorkflowTrigger } from '../../sdk';
import type { WorkflowCatalog } from '../queries';
import AbortTriggersCard from './AbortTriggersCard.vue';
import TriggerCard from './TriggerCard.vue';

/** The inspector for the trigger node: what starts runs, and what aborts them. */
defineProps<{
  trigger: WorkflowTrigger;
  abortTriggers: WorkflowAbortTrigger[];
  spaceId: string | null;
  catalog: WorkflowCatalog | undefined;
  readOnly: boolean;
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{
  'update:trigger': [trigger: WorkflowTrigger];
  'update:abortTriggers': [triggers: WorkflowAbortTrigger[]];
}>();
</script>

<template>
  <TriggerCard
    :trigger="trigger"
    :space-id="spaceId"
    :catalog="catalog"
    :read-only="readOnly"
    :error-for="errorFor"
    @update="emit('update:trigger', $event)"
  />
  <AbortTriggersCard
    :triggers="abortTriggers"
    :space-id="spaceId"
    :catalog="catalog"
    :read-only="readOnly"
    :error-for="errorFor"
    @update="emit('update:abortTriggers', $event)"
  />
</template>
