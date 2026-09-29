<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import FormField from './FormField.vue';

/** A labelled `<textarea class="mb-input">`; attributes and classes land on the textarea. */
defineOptions({ inheritAttrs: false });

defineProps<{
  label?: string | undefined;
  id?: string | undefined;
  hint?: string | undefined;
  error?: string | null | false | undefined;
  /** Classes for the wrapper. */
  fieldClass?: string | undefined;
}>();

const model = defineModel<string | null | undefined>();
const attrs = useAttrs();

const proxy = computed({
  get: () => model.value ?? '',
  set: (next: string) => {
    model.value = next;
  },
});
</script>

<template>
  <FormField :id="id" :label="label" :hint="hint" :error="error" :class="fieldClass">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template #default="{ id: controlId }">
      <textarea :id="controlId" v-model="proxy" v-bind="attrs" class="mb-input" />
    </template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
  </FormField>
</template>
