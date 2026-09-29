<script setup lang="ts">
import { FormDialog, TextField } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import type { WorkflowCallParameter } from '../../sdk';

/** The values a called workflow takes, asked for before running it by hand. */
const props = defineProps<{ parameters: WorkflowCallParameter[] }>();
const emit = defineEmits<{ run: [input: Record<string, string>]; close: [] }>();

const values = ref<Record<string, string>>(
  Object.fromEntries(props.parameters.map((parameter) => [parameter.name, ''])),
);

const missing = computed(() =>
  props.parameters.some((parameter) => parameter.required && !values.value[parameter.name]?.trim()),
);
</script>

<template>
  <FormDialog
    title="Run it with these values"
    form-class="wf:space-y-4"
    submit-label="Run now"
    busy-label="Running..."
    :disabled="missing"
    @submit="emit('run', values)"
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
      Each reaches the nodes as <span class="wf:font-mono" v-pre>{{ input.name }}</span>, as text.
    </p>
  </FormDialog>
</template>
