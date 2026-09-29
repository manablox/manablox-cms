<script setup lang="ts">
import { type ErrorFor, TextField } from '@manablox/admin-sdk';
import type { TriggerOf } from '../../model';
import ParameterList from './ParameterList.vue';

type Call = TriggerOf<'call'>;

/** What a calling workflow hands over, and what this one hands back. */
const props = defineProps<{
  trigger: Call;
  readOnly: boolean;
  /** Errors under the trigger. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [trigger: Call] }>();

const patch = (change: Partial<Call>) => emit('update', { ...props.trigger, ...change });
</script>

<template>
  <p class="mb-meta">
    Add a "Run a workflow" node to another workflow and pick this one. It runs with that
    run's document and hands back what you name below.
  </p>

  <ParameterList :parameters="trigger.parameters" :read-only="readOnly" :error-for="errorFor" @update="patch({ parameters: $event })" />

  <TextField
    label="Hands back"
    class="mb-input-mono"
    :model-value="trigger.output"
    :readonly="readOnly"
    placeholder="{{ nodes.shape }}"
    :error="errorFor(['output'])"
    @update:model-value="patch({ output: String($event ?? '') })"
  >
    <template #hint>
      <p class="wf:mt-1 mb-meta">
        Read when the run ends; the caller finds it under
        <span class="wf:font-mono" v-pre>{{ nodes.&lt;key&gt;.output }}</span>. A placeholder on its own keeps its type.
        Empty hands back every node's result by key.
      </p>
    </template>
  </TextField>
</template>
