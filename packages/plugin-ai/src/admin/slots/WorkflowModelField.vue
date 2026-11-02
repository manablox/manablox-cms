<script setup lang="ts">
import { Select, useSpaceStore } from '@manablox/admin-sdk';
import type { WorkflowFieldControlProps } from '@manablox/plugin-workflows/admin-slots';
import { computed } from 'vue';
import { useAiAvailable, useAiCatalog, useAiProviders } from '../queries';

/**
 * The AI step's provider and model fields in the workflow editor: a provider of the space, and
 * a model the provider offers for the node's job, or typed in for a self-hosted one.
 */
const props = defineProps<WorkflowFieldControlProps>();

const spaces = useSpaceStore();
const isModel = computed(() => (props.spec.kind as string) === 'aiModel');
const modelSpace = () => (isModel.value ? spaces.currentId : null);
const { data: catalog } = useAiCatalog();
const { data: providers } = useAiProviders(modelSpace);
const { data: available } = useAiAvailable(modelSpace);

const text = computed(() => (typeof props.value === 'string' ? props.value : ''));
/** The typed-in model of a self-hosted provider. */
const typedModel = computed({
  get: () => text.value,
  set: (value: string) => props.update(value),
});

/** The provider for an `aiModel` field: the node's, or the first available for the job. */
const capability = computed(() => {
  const value = props.config.capability;
  return value === 'image' || value === 'video' ? value : 'text';
});
const provider = computed(() => {
  const named = typeof props.config.provider === 'string' ? props.config.provider : '';
  const ref = named || available.value?.[capability.value]?.[0] || '';
  const row = providers.value?.find((entry) => entry.ref === ref);
  const meta = catalog.value?.providers.find((entry) => entry.kind === (row?.kind ?? ref));
  return { ref, row, meta };
});
/** Self-hosted models are typed in, not picked. */
const typed = computed(() => provider.value.row?.kind === 'custom');

const modelOptions = computed(() => {
  const { row, meta } = provider.value;
  const configured =
    row?.models?.[capability.value] ?? meta?.defaultModels?.[capability.value] ?? '';
  const options = [
    {
      value: '',
      label: configured ? `The provider's model (${configured})` : "The provider's model",
      hint: undefined as string | undefined,
    },
    ...(meta?.models?.[capability.value] ?? []).map((model) => ({
      value: model.id,
      label: model.label,
      hint: model.id,
    })),
  ];
  // Keep an unlisted current model visible.
  if (text.value && !options.some((option) => option.value === text.value)) {
    options.push({ value: text.value, label: text.value, hint: 'not offered by this provider' });
  }
  return options;
});

/** The provider field lists what the server offers. */
const providerOptions = computed(() =>
  (props.spec.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
    hint: option.hint,
  })),
);
</script>

<template>
  <template v-if="isModel">
    <input
      v-if="typed"
      :id="id"
      v-model="typedModel"
      class="mb-input mb-input-mono"
      placeholder="The provider's model"
      :readonly="readOnly"
    />
    <Select
      v-else
      :id="id"
      :model-value="text"
      :options="modelOptions"
      :disabled="readOnly"
      @update:model-value="update($event)"
    />
  </template>
  <Select
    v-else
    :id="id"
    :model-value="text"
    :options="providerOptions"
    :disabled="readOnly"
    @update:model-value="update($event)"
  />
</template>
