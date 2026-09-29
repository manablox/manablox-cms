<script setup lang="ts">
import {
  ChipToggle,
  type ErrorFor,
  FormField,
  KeyValueList,
  NumberField,
  Select,
  StringList,
  Switch,
  useContentTypes,
  useSlotEntries,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import type { WorkflowFieldSpec, WorkflowRuleSet } from '../../sdk';
import type { PlaceholderHint } from '../model';
import { useSpaceMembers, useSpaceRoles, type WorkflowCatalog } from '../queries';
import PlaceholderComplete from './PlaceholderComplete.vue';
import PlaceholderHelp from './PlaceholderHelp.vue';
import RuleList from './RuleList.vue';

/**
 * One action form field, rendered from the server's description so plugin actions get forms.
 * Field kinds other plugins contribute draw their control in `workflows:fieldControl`.
 */
const props = defineProps<{
  spec: WorkflowFieldSpec;
  value: unknown;
  /** The node's config, for fields that depend on others. */
  config: Record<string, unknown>;
  readOnly: boolean;
  hints: PlaceholderHint[];
  /** The `rules` kind reads its operators from here. */
  catalog: WorkflowCatalog | undefined;
  /** Errors by path under the field; `[]` is the field's own. */
  errorFor: ErrorFor;
  id: string;
}>();
const emit = defineEmits<{ update: [value: unknown] }>();

const spaces = useSpaceStore();
const picksRoles = computed(() => props.spec.kind === 'role');
const picksMembers = computed(() => props.spec.kind === 'user');
const { data: roles } = useSpaceRoles(picksRoles);
const { data: members } = useSpaceMembers(picksMembers);
const { data: contentTypes } = useContentTypes();

/** A contributed field kind's control. */
const controls = useSlotEntries('workflows:fieldControl');
const control = computed(
  () =>
    controls.value.find((item) => (item.entry as { kind?: string }).kind === props.spec.kind) ??
    null,
);
const update = (value: unknown) => emit('update', value);

/** The value of the text kinds; a write sends it up. */
const text = computed({
  get: () => (typeof props.value === 'string' ? props.value : ''),
  set: (value: string) => emit('update', value),
});

const error = computed(() => props.errorFor([]));

/** The `rules` kind's value; a field not set yet starts with no rules. */
const ruleSet = computed<WorkflowRuleSet>(() => {
  const value = props.value as Partial<WorkflowRuleSet> | null | undefined;
  return {
    match: value?.match === 'any' ? 'any' : 'all',
    rules: Array.isArray(value?.rules) ? value.rules : [],
  };
});

const list = computed(() => (Array.isArray(props.value) ? (props.value as string[]) : []));
const pairs = computed(() =>
  Array.isArray(props.value) ? (props.value as Array<{ name: string; value: string }>) : [],
);

/** Fields that accept placeholders. */
const templated = computed(
  () => props.spec.kind === 'template' || props.spec.kind === 'templateArea',
);

/** Fields a placeholder may go in: templates, JSON bodies and header rows. */
const takesPlaceholders = computed(
  () => templated.value || props.spec.kind === 'json' || props.spec.kind === 'keyValue',
);

const options = computed(() => {
  if (props.spec.options)
    return props.spec.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }));
  if (props.spec.kind === 'contentType') {
    return [
      { value: '', label: 'Choose a type' },
      ...(contentTypes.value ?? []).map((type) => ({
        value: type.id,
        label: type.label,
        hint: type.name,
      })),
    ];
  }
  if (props.spec.kind === 'locale') {
    return [
      { value: '', label: "The space's default" },
      ...(spaces.current?.locales ?? ['en']).map((code) => ({ value: code, label: code })),
    ];
  }
  return [];
});

const chips = computed(() => {
  if (props.spec.kind === 'role') {
    return (roles.value ?? []).map((role) => ({ value: role.machineName, label: role.name }));
  }
  if (props.spec.kind === 'user') {
    return (members.value ?? []).map((member) => ({
      value: member.userId,
      label: member.user?.name || member.user?.email || member.userId,
    }));
  }
  return (props.spec.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
  }));
});

function toggle(value: string) {
  const next = list.value.includes(value)
    ? list.value.filter((entry) => entry !== value)
    : [...list.value, value];
  emit('update', next);
}

/** The `json` kind covers objects and strings, so check the value, not the field name. */
const jsonMode = computed(() =>
  props.value && typeof props.value === 'object' && 'mode' in (props.value as object)
    ? (props.value as { mode: string; template: string })
    : null,
);
const jsonText = computed({
  get: () =>
    jsonMode.value ? jsonMode.value.template : typeof props.value === 'string' ? props.value : '',
  set: (value: string) =>
    emit('update', jsonMode.value ? { ...jsonMode.value, template: value } : value),
});
</script>

<template>
  <PlaceholderComplete :hints="takesPlaceholders ? hints : []" :class="spec.width === 'half' ? 'wf:sm:col-span-1' : 'wf:sm:col-span-2'">
  <FormField :id="id" :label="spec.label">
    <template v-if="takesPlaceholders" #actions>
      <PlaceholderHelp :hints="hints" />
    </template>

    <component
      :is="control.component"
      v-if="control"
      :spec="spec"
      :value="value"
      :config="config"
      :read-only="readOnly"
      :id="id"
      :update="update"
    />

    <input
      v-else-if="spec.kind === 'text' || spec.kind === 'template'"
      :id="id"
      v-model="text"
      class="mb-input"
      :class="spec.kind === 'template' ? 'wf:font-mono wf:text-xs' : ''"
      :placeholder="spec.placeholder"
      :readonly="readOnly"
    />

    <input
      v-else-if="spec.kind === 'password'"
      :id="id"
      v-model="text"
      type="password"
      class="mb-input mb-input-mono"
      autocomplete="off"
      :placeholder="spec.placeholder"
      :readonly="readOnly"
    />

    <textarea
      v-else-if="spec.kind === 'textarea' || spec.kind === 'templateArea'"
      :id="id"
      v-model="text"
      class="mb-input"
      :class="spec.kind === 'templateArea' ? 'wf:font-mono wf:text-xs' : ''"
      :rows="spec.rows ?? 5"
      :placeholder="spec.placeholder"
      :readonly="readOnly"
    />

    <NumberField
      v-else-if="spec.kind === 'number'"
      :id="id"
      :model-value="typeof value === 'number' ? value : undefined"
      :mode="Number.isInteger(spec.step ?? 1) ? 'integer' : 'decimal'"
      :min="spec.min"
      :max="spec.max"
      :step="spec.step ?? 1"
      :readonly="readOnly"
      @update:model-value="emit('update', $event)"
    />

    <Switch
      v-else-if="spec.kind === 'switch'"
      :model-value="value === true"
      :disabled="readOnly"
      :aria-label="spec.label"
      @update:model-value="emit('update', $event)"
    />

    <Select
      v-else-if="spec.kind === 'select' || spec.kind === 'contentType' || spec.kind === 'locale'"
      :id="id"
      :model-value="text"
      :options="options"
      :disabled="readOnly"
      @update:model-value="emit('update', $event)"
    />

    <div v-else-if="spec.kind === 'multiselect' || spec.kind === 'role' || spec.kind === 'user'" class="wf:flex wf:flex-wrap wf:gap-1.5">
      <ChipToggle
        v-for="chip in chips"
        :key="chip.value"
        :model-value="list.includes(chip.value)"
        :disabled="readOnly"
        @update:model-value="toggle(chip.value)"
      >
        {{ chip.label }}
      </ChipToggle>
      <p v-if="!chips.length" class="mb-meta">Nothing to choose from yet.</p>
    </div>

    <StringList
      v-else-if="spec.kind === 'stringList'"
      :model-value="list"
      :read-only="readOnly"
      :label="spec.label"
      :placeholder="spec.placeholder"
      @update:model-value="emit('update', $event)"
    />

    <KeyValueList
      v-else-if="spec.kind === 'keyValue'"
      :model-value="pairs"
      :read-only="readOnly"
      :label="spec.label"
      @update:model-value="emit('update', $event)"
    />

    <RuleList
      v-else-if="spec.kind === 'rules'"
      :match="ruleSet.match"
      :rules="ruleSet.rules"
      lead="Match when"
      :read-only="readOnly"
      :hints="hints"
      :catalog="catalog"
      :error-for="errorFor"
      @update="emit('update', { ...ruleSet, ...$event })"
    />

    <div v-else-if="spec.kind === 'json'">
      <div v-if="jsonMode" class="wf:mb-2">
        <Select
          :model-value="jsonMode.mode"
          :options="[
            { value: 'event', label: 'The whole event as JSON' },
            { value: 'custom', label: 'A body I write' },
            { value: 'none', label: 'No body' },
          ]"
          :disabled="readOnly"
          :aria-label="`${spec.label}: what to send`"
          @update:model-value="emit('update', { ...jsonMode, mode: $event })"
        />
      </div>
      <textarea
        v-if="!jsonMode || jsonMode.mode === 'custom'"
        :id="id"
        v-model="jsonText"
        class="mb-input mb-input-mono"
        :rows="spec.rows ?? 8"
        :readonly="readOnly"
        spellcheck="false"
      />
    </div>

    <p v-if="spec.hint" class="wf:mt-1 mb-meta">{{ spec.hint }}</p>
    <p v-if="error" class="mb-error">{{ error }}</p>
  </FormField>
  </PlaceholderComplete>
</template>
