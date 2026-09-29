<script setup lang="ts">
import { Checkbox, type ErrorFor, Icon, IconButton, TextField } from '@manablox/admin-sdk';
import type { WorkflowCallParameter } from '../../../sdk';

/** The values a workflow takes, each read as `{{ input.<name> }}`. */
const props = defineProps<{
  parameters: WorkflowCallParameter[];
  readOnly: boolean;
  /** Errors under the trigger. */
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [parameters: WorkflowCallParameter[]] }>();

function patchParameter(index: number, change: Partial<WorkflowCallParameter>) {
  emit(
    'update',
    props.parameters.map((entry, i) => (i === index ? { ...entry, ...change } : entry)),
  );
}

function addParameter() {
  emit('update', [...props.parameters, { name: '', description: '', required: false }]);
}

function removeParameter(index: number) {
  emit(
    'update',
    props.parameters.filter((_, i) => i !== index),
  );
}
</script>

<template>
  <fieldset>
    <legend class="mb-label">Values it takes</legend>
    <p v-if="!parameters.length" class="mb-hint">None yet. Each one is read as <span class="wf:font-mono" v-pre>{{ input.name }}</span>.</p>
    <div v-for="(parameter, index) in parameters" :key="index" class="wf:mb-2 wf:space-y-1.5 wf:rounded-card wf:border wf:border-surface-200 wf:p-2 wf:dark:border-surface-800">
      <div class="wf:flex wf:items-center wf:gap-2">
        <TextField
          :model-value="parameter.name"
          field-class="wf:min-w-0 wf:flex-1"
          class="mb-input-mono"
          placeholder="orderId"
          :readonly="readOnly"
          :aria-label="`Value ${index + 1}: name`"
          @update:model-value="patchParameter(index, { name: String($event ?? '') })"
        />
        <Checkbox class="wf:shrink-0 wf:cursor-pointer" :model-value="parameter.required" :disabled="readOnly" @update:model-value="patchParameter(index, { required: $event })">
          <span class="wf:text-xs">Required</span>
        </Checkbox>
        <IconButton v-if="!readOnly" icon="x" :label="`Remove value ${index + 1}`" size="md" class="wf:shrink-0" @click="removeParameter(index)" />
      </div>
      <p v-if="errorFor(['parameters', index, 'name'])" class="mb-error">{{ errorFor(['parameters', index, 'name']) }}</p>
      <TextField
        :model-value="parameter.description"
        placeholder="What it is, for whoever runs it"
        :readonly="readOnly"
        :aria-label="`Value ${index + 1}: description`"
        @update:model-value="patchParameter(index, { description: String($event ?? '') })"
      />
    </div>
    <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" @click="addParameter">
      <Icon name="plus" class="mb-icon-sm" /> Add a value
    </button>
  </fieldset>
</template>
