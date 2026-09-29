<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import FormField from './FormField.vue';

/** A labelled `<input class="mb-input">`; attributes and classes land on the input. */
defineOptions({ inheritAttrs: false });

defineProps<{
  label?: string | undefined;
  id?: string | undefined;
  hint?: string | undefined;
  error?: string | null | false | undefined;
  /** Classes for the wrapper. */
  fieldClass?: string | undefined;
}>();

const [model, modifiers] = defineModel<string | number | null | undefined>();
const attrs = useAttrs();

/** Numbers come back as numbers for `type="number"` or the `.number` modifier, as with `v-model`. */
const castToNumber = computed(() => modifiers.number || attrs.type === 'number');

const proxy = computed({
  get: () => model.value ?? '',
  set: (next: string) => {
    if (!castToNumber.value) {
      model.value = next;
      return;
    }
    const parsed = Number.parseFloat(next);
    model.value = Number.isNaN(parsed) ? next : parsed;
  },
});
</script>

<template>
  <FormField :id="id" :label="label" :hint="hint" :error="error" :class="fieldClass">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template #default="{ id: controlId }">
      <input :id="controlId" v-model="proxy" v-bind="attrs" class="mb-input" />
    </template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
  </FormField>
</template>
