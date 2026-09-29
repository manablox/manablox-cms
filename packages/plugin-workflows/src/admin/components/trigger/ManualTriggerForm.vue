<script setup lang="ts">
import { type ErrorFor } from '@manablox/admin-sdk';
import type { TriggerOf } from '../../model';
import ParameterList from './ParameterList.vue';

type Manual = TriggerOf<'manual'>;

/** What whoever starts the workflow is asked for. */
const props = defineProps<{
  trigger: Manual;
  readOnly: boolean;
  /** Errors under the trigger. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [trigger: Manual] }>();
</script>

<template>
  <p class="mb-meta">
    Nothing starts it on its own. Once published and switched on, "Run" on the workflow starts
    its live version, asking for the values below.
  </p>

  <ParameterList :parameters="trigger.parameters" :read-only="readOnly" :error-for="errorFor" @update="emit('update', { ...props.trigger, parameters: $event })" />
</template>
