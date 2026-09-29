<script setup lang="ts">
import { type ErrorFor, scoped } from '@manablox/admin-sdk';
import { computed } from 'vue';
import type { WorkflowFieldSpec } from '../../sdk';
import type { PlaceholderHint } from '../model';
import type { WorkflowCatalog } from '../queries';
import FieldControl from './FieldControl.vue';

/** An action's form from the catalogue's field list. Fields can show conditionally on another's value. */
const props = defineProps<{
  fields: WorkflowFieldSpec[];
  config: Record<string, unknown>;
  readOnly: boolean;
  hints: PlaceholderHint[];
  catalog: WorkflowCatalog | undefined;
  idPrefix: string;
  errorFor: ErrorFor;
}>();
const emit = defineEmits<{ update: [config: Record<string, unknown>] }>();

/** Dotted names like `styles.tone` read inside an object. */
function read(name: string): unknown {
  const [head, tail] = name.split('.') as [string, string | undefined];
  const value = props.config[head];
  if (!tail) return value;
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[tail] : undefined;
}

function write(name: string, value: unknown) {
  const [head, tail] = name.split('.') as [string, string | undefined];
  if (!tail) {
    emit('update', { ...props.config, [head]: value });
    return;
  }
  const nested = (props.config[head] ?? {}) as Record<string, unknown>;
  emit('update', { ...props.config, [head]: { ...nested, [tail]: value } });
}

const visible = computed(() =>
  props.fields.filter((field) => {
    if (!field.showWhen) return true;
    return field.showWhen.equals.includes(read(field.showWhen.field) as string);
  }),
);
</script>

<template>
  <div class="wf:grid wf:gap-4 wf:sm:grid-cols-2">
    <FieldControl
      v-for="field in visible"
      :key="field.name"
      :spec="field"
      :value="read(field.name)"
      :config="config"
      :read-only="readOnly"
      :hints="hints"
      :catalog="catalog"
      :id="`${idPrefix}-${field.name.replace('.', '-')}`"
      :error-for="scoped(errorFor, ['config', ...field.name.split('.')])"
      @update="write(field.name, $event)"
    />
  </div>
</template>
