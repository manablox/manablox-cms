<script setup lang="ts">
import { FormDialog, requireSpace, runWrite, TextField } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useWorkflowVersion, workflows } from '../queries';

/** Starts the live version of a manual workflow with the values it asks for, then opens the run. */
const props = defineProps<{ workflowId: string; name: string; version: number }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const { data: live } = useWorkflowVersion(
  () => props.workflowId,
  () => props.version,
);
const parameters = computed(() =>
  live.value?.trigger.kind === 'manual' ? live.value.trigger.parameters : [],
);
const values = ref<Record<string, string>>({});

const missing = computed(
  () =>
    !live.value ||
    parameters.value.some(
      (parameter) => parameter.required && !values.value[parameter.name]?.trim(),
    ),
);

function start() {
  return runWrite(
    async () => {
      const run = await workflows.start(requireSpace(), props.workflowId, values.value);
      await router.push(`/workflows/${props.workflowId}/runs/${run.id}`);
      return run;
    },
    { success: `Started "${props.name}"` },
  );
}
</script>

<template>
  <FormDialog
    :title="`Run ${name}`"
    form-class="wf:space-y-4"
    submit-label="Run now"
    busy-label="Starting..."
    :disabled="missing"
    @submit="start"
    @close="emit('close')"
  >
    <TextField
      v-for="parameter in parameters"
      :key="parameter.name"
      v-model="values[parameter.name]"
      :label="parameter.required ? `${parameter.name} (required)` : parameter.name"
      class="wf:font-mono wf:text-xs"
      :hint="parameter.description || undefined"
    />
    <p class="mb-meta">
      Starts version {{ version }}, the live one. Its actions really happen.
      <template v-if="parameters.length">Each value reaches the nodes as <span class="wf:font-mono" v-pre>{{ input.name }}</span>, as text.</template>
    </p>
  </FormDialog>
</template>
