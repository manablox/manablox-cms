<script setup lang="ts">
import { type ErrorFor, NumberField } from '@manablox/admin-sdk';
import type { WorkflowNodeOf } from '../../../sdk';

type Delay = WorkflowNodeOf<'delay'>;

/** How long a delay node waits. */
const props = defineProps<{
  node: Delay;
  readOnly: boolean;
  /** Errors under the node. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [node: Delay] }>();

const patch = (change: Partial<Delay>) => emit('update', { ...props.node, ...change });
</script>

<template>
  <div class="wf:flex wf:items-end wf:gap-2">
    <NumberField
      :model-value="node.minutes"
      label="Wait for"
      class="wf:w-32"
      :min="1"
      :readonly="readOnly"
      :error="errorFor(['minutes'])"
      @update:model-value="$event != null && patch({ minutes: $event })"
    />
    <span class="wf:pb-2.5 wf:text-sm wf:text-surface-500">minutes</span>
  </div>
</template>
