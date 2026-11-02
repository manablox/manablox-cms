<script setup lang="ts">
import { FormField, Select } from '@manablox/admin-sdk';
import { computed, watch } from 'vue';
import { useAiCatalog, useAiProviders } from '../queries';

/** Provider picker for design jobs, shown only when there is a choice. */
const props = withDefaults(
  defineProps<{
    spaceId: string;
    /** Capable provider refs. */
    refs: string[];
    hint?: string;
  }>(),
  { hint: 'Designs are long answers; the strongest model you have does them best.' },
);
const model = defineModel<string>({ required: true });

const catalog = useAiCatalog();
const providers = useAiProviders(() => props.spaceId);

const options = computed(() =>
  props.refs.map((ref) => ({
    value: ref,
    label:
      providers.data.value?.find((row) => row.ref === ref)?.label ??
      catalog.data.value?.providers.find((meta) => meta.kind === ref)?.label ??
      ref,
  })),
);

watch(
  () => props.refs,
  (refs) => {
    if (!refs.includes(model.value)) model.value = refs[0] ?? '';
  },
  { immediate: true },
);
</script>

<template>
  <!-- Shown once providers load and there is a choice. -->
  <FormField
    v-if="options.length > 1 && providers.data.value"
    label="Provider"
    :hint="hint || undefined"
    v-slot="{ id }"
  >
    <Select :id="id" v-model="model" :options="options" />
  </FormField>
</template>
