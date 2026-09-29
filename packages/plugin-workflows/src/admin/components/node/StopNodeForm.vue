<script setup lang="ts">
import { type ErrorFor, SegmentedControl, TextField } from '@manablox/admin-sdk';
import type { WorkflowNodeOf } from '../../../sdk';
import type { PlaceholderHint } from '../../model';
import PlaceholderComplete from '../PlaceholderComplete.vue';
import PlaceholderHelp from '../PlaceholderHelp.vue';

type Stop = WorkflowNodeOf<'stop'>;

/** How a stop node ends the run, and what it says. */
const props = defineProps<{
  node: Stop;
  readOnly: boolean;
  hints: PlaceholderHint[];
  /** Errors under the node. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [node: Stop] }>();

const patch = (change: Partial<Stop>) => emit('update', { ...props.node, ...change });

const OUTCOMES = [
  { value: 'succeeded', label: 'End the run' },
  { value: 'failed', label: 'Fail the run' },
] as const;
</script>

<template>
  <PlaceholderComplete :hints="hints" class="wf:space-y-4">
    <SegmentedControl
      :model-value="node.outcome"
      :options="OUTCOMES"
      :columns="2"
      :disabled="readOnly"
      aria-label="How the run ends"
      @update:model-value="patch({ outcome: $event })"
    />
    <TextField
      label="Message"
      :model-value="node.message"
      :placeholder="node.outcome === 'failed' ? 'Stopped as failed' : 'Ended the run here'"
      :readonly="readOnly"
      :error="errorFor(['message'])"
      @update:model-value="patch({ message: String($event ?? '') })"
    >
      <template #actions><PlaceholderHelp :hints="hints" /></template>
      <template #hint>
        <p class="wf:mt-1 mb-meta">
          {{ node.outcome === 'failed' ? 'The run is marked failed with this as its error.' : 'Shown in the run log.' }}
          Every other branch stops too.
        </p>
      </template>
    </TextField>
  </PlaceholderComplete>
</template>
