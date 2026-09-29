<script setup lang="ts">
import { computed, ref, useAttrs, watch } from 'vue';
import FormField from './FormField.vue';

/**
 * A labelled number input that emits numbers: empty is `undefined` (`null` with `nullable`),
 * partial input like `-` emits nothing, and `min` / `max` clamp on change.
 */
defineOptions({ inheritAttrs: false });

const model = defineModel<number | null | undefined>();
const props = withDefaults(
  defineProps<{
    label?: string | undefined;
    id?: string | undefined;
    hint?: string | undefined;
    error?: string | null | false | undefined;
    /** Classes for the wrapper. */
    fieldClass?: string | undefined;
    mode?: 'integer' | 'decimal';
    min?: number | undefined;
    max?: number | undefined;
    /** Defaults to 1 for integers, any for decimals. */
    step?: number | 'any' | undefined;
    nullable?: boolean;
  }>(),
  {
    mode: 'integer',
    nullable: false,
  },
);
const attrs = useAttrs();

const empty = computed(() => (props.nullable ? null : undefined));
const text = ref(format(model.value));

function format(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? '' : String(value);
}

/** The number in `raw`, `empty` when blank, or `false` when it is not one yet. */
function parse(raw: string): number | null | undefined | false {
  const trimmed = raw.trim();
  if (trimmed === '') return empty.value;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return false;
  if (props.mode === 'integer' && !Number.isInteger(value)) return false;
  return value;
}

function clamp(value: number): number {
  let out = value;
  if (props.min !== undefined) out = Math.max(props.min, out);
  if (props.max !== undefined) out = Math.min(props.max, out);
  return out;
}

// An outside change replaces the text unless it already reads as that number.
watch(model, (value) => {
  if (parse(text.value) !== value) text.value = format(value);
});

function onInput(event: Event) {
  text.value = (event.target as HTMLInputElement).value;
  const value = parse(text.value);
  if (value !== false && value !== model.value) model.value = value;
}

function onChange() {
  const value = parse(text.value);
  if (value === false) {
    text.value = format(model.value);
    return;
  }
  if (value === null || value === undefined) return;
  const clamped = clamp(value);
  if (clamped !== value || clamped !== model.value) model.value = clamped;
  text.value = format(clamped);
}
</script>

<template>
  <FormField :id="id" :label="label" :hint="hint" :error="error" :class="fieldClass">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    <template #default="{ id: controlId }">
      <input
        :id="controlId"
        v-bind="attrs"
        :value="text"
        type="number"
        :inputmode="mode === 'integer' ? 'numeric' : 'decimal'"
        :min="min"
        :max="max"
        :step="step ?? (mode === 'integer' ? 1 : 'any')"
        class="mb-input"
        @input="onInput"
        @change="onChange"
      />
    </template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
  </FormField>
</template>
