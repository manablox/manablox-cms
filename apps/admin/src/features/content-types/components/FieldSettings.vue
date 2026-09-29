<script setup lang="ts">
import CheckCard from '@manablox/admin-sdk/components/ui/CheckCard.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { type ErrorFor, scoped } from '@manablox/admin-sdk/composables/useDraftForm';
import { useTemplates } from '@manablox/admin-sdk/features/content/queries';
import type { FieldDefinition } from '@manablox/admin-sdk/features/content-types/queries';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { technicalName } from '@manablox/core';
import { computed, defineAsyncComponent, useTemplateRef } from 'vue';
import { useDerivedName } from '~/composables/useDerivedName';
import FieldSettingControl from '~/features/content-types/components/FieldSettingControl.vue';
import { FLAGS, specsFor, WIDTHS, ZONES } from '~/features/content-types/field-setting-specs';
import { type ErrorUnder, moveField, newField, scopedUnder } from '~/features/content-types/model';
import { settingsComponent } from '~/lib/field-components';
import { completeSubFields, MAX_REPEATER_DEPTH, toRawSubField } from '~/lib/sub-fields';

/** Per-field configuration in the type builder; type-specific settings come from `SPECS`. */
const props = defineProps<{
  modelValue: FieldDefinition;
  readOnly: boolean;
  /** Saved field; its name is fixed. */
  locked?: boolean;
  /** Id stem; a string for repeater sub-fields. */
  index: number | string;
  /** Scoped to this field: `['name']`, `['settings']`. */
  errorFor: ErrorFor;
  errorUnder?: ErrorUnder | undefined;
  /** The saved version of this field, for its sub-fields' locked names. */
  saved?: FieldDefinition | null;
  /** 0 for a type's own fields, 1 inside a repeater, and so on. */
  depth?: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [FieldDefinition] }>();

const spaces = useSpaceStore();

const field = computed({
  get: () => props.modelValue,
  set: (next: FieldDefinition) => emit('update:modelValue', next),
});

/** The next value while one edit is being composed, so label and name emit together. */
let editing: FieldDefinition | null = null;
function edit(change: (next: FieldDefinition) => void): void {
  const next = { ...field.value };
  editing = next;
  change(next);
  editing = null;
  field.value = next;
}

/** Stateless: a hand-edited name stops matching the label, which stops the following. */
const derived = useDerivedName({
  read: () => (editing ?? field.value).name,
  write: (name) => {
    if (editing) editing.name = name;
  },
  follows: () =>
    !props.locked && (!field.value.name || field.value.name === technicalName(field.value.label)),
});

function onLabelInput(value: string) {
  edit((next) => {
    next.label = value;
    derived.onLabelInput(value);
  });
}

/** Trailing separators are trimmed only on blur. */
function onLabelBlur() {
  if (derived.follows()) edit(() => derived.onNameBlur());
}

function setSetting(key: string, value: unknown) {
  field.value = { ...field.value, settings: { ...field.value.settings, [key]: value } };
}
function setAdmin(key: string, value: unknown) {
  field.value = { ...field.value, admin: { ...field.value.admin, [key]: value } };
}

const specs = computed(() => specsFor(field.value.type, field.value.settings));

/** Sub-fields store no translation, uniqueness or zone of their own. */
const isSubField = computed(() => (props.depth ?? 0) > 0);
const flags = computed(() =>
  isSubField.value ? FLAGS.filter((flag) => flag.key === 'required') : FLAGS,
);

// Recursive: a repeater's sub-field list renders this component again.
const FieldList = defineAsyncComponent(
  () => import('~/features/content-types/components/FieldList.vue'),
);
const subList = useTemplateRef<{ open: (id: string) => void }>('subList');

const isRepeater = computed(() => field.value.type === 'repeater');
const subFields = computed(() => (isRepeater.value ? completeSubFields(field.value.settings) : []));
const savedSubFields = computed(() => (props.saved ? completeSubFields(props.saved.settings) : []));
/** A repeater at the depth limit cannot hold another. */
const subFieldTypes = computed(() =>
  (props.depth ?? 0) + 1 >= MAX_REPEATER_DEPTH
    ? spaces.fieldTypes.filter((meta) => meta.name !== 'repeater')
    : spaces.fieldTypes,
);

function writeSubFields(list: FieldDefinition[]) {
  setSetting(
    'fields',
    list.map((entry) => toRawSubField(entry)),
  );
}
function addSubField(typeName: string) {
  const entry = newField(typeName, spaces.fieldTypeMeta(typeName), subFields.value.length);
  writeSubFields([...subFields.value, entry]);
  subList.value?.open(entry.id);
}
function removeSubField(id: string) {
  writeSubFields(subFields.value.filter((entry) => entry.id !== id));
}
function moveSubField(from: number, to: number) {
  writeSubFields(moveField(subFields.value, from, to));
}
function updateSubField(index: number, entry: FieldDefinition) {
  writeSubFields(subFields.value.map((current, at) => (at === index ? entry : current)));
}
/** A plugin's settings form for the type, keyed by its `admin.settings`. */
const pluginSettings = computed(() => {
  const key = spaces.fieldTypeMeta(field.value.type)?.admin.settings;
  return key ? settingsComponent(key) : null;
});

const valueSpecs = computed(() => specs.value.filter((spec) => spec.group === 'value'));
const ruleSpecs = computed(() => specs.value.filter((spec) => spec.group === 'rules'));

/** Block fields pick block types, databag fields databag types; others both documents and databags. */
const candidateTypes = computed(() =>
  field.value.type === 'block' || field.value.type === 'blocks'
    ? spaces.blockKinds
    : field.value.type === 'databag'
      ? spaces.dataKinds
      : [...spaces.creatableKinds, ...spaces.dataKinds],
);

const { data: templatePage } = useTemplates(
  () => spaces.locale,
  () => spaces.templateType?.id ?? null,
);
const candidateTemplates = computed(() =>
  (templatePage.value?.items ?? []).map((item) => ({
    id: item.id,
    label: item.title || 'Untitled',
  })),
);

function toggleTemplate(id: string) {
  const current = (field.value.settings.templates as string[]) ?? [];
  setSetting(
    'templates',
    current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
  );
}

function toggleType(id: string) {
  if (field.value.type === 'block') return setSetting('type', id);
  const current = (field.value.settings.types as string[]) ?? [];
  setSetting('types', current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

const optionsText = computed({
  get: () =>
    ((field.value.settings.options as { value: string }[]) ?? []).map((o) => o.value).join('\n'),
  set: (text: string) =>
    setSetting(
      'options',
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((value) => ({ value })),
    ),
});

const acceptList = computed({
  get: () => {
    const raw = field.value.settings.accept;
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  },
  set: (list: string[]) => setSetting('accept', list),
});
</script>

<template>
  <div class="space-y-5">
    <section class="grid gap-3 sm:grid-cols-2">
      <TextField
        :id="`field-${index}-label`"
        label="Label"
        :model-value="field.label"
        :disabled="readOnly"
        hint="What editors see above the input."
        @update:model-value="onLabelInput(String($event ?? ''))"
        @blur="onLabelBlur"
      />
      <TextField
        :id="`field-${index}-name`"
        label="Technical name"
        :model-value="field.name"
        :disabled="readOnly || locked"
        class="mb-input-mono"
        placeholder="from the label"
        :hint="
          locked
            ? 'Part of the published GraphQL schema, so it can no longer be renamed. Remove the field and add it again to change it.'
            : 'Follows the label until you type one yourself. Fixed once the type is saved.'
        "
        :error="errorFor(['name'])"
        @update:model-value="edit(() => derived.onNameInput(String($event ?? '')))"
        @blur="edit(() => derived.onNameBlur())"
      />
    </section>

    <section v-if="valueSpecs.length">
      <p class="mb-eyebrow mb-2">Value</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <div v-for="spec in valueSpecs" :key="spec.key" :class="spec.wide ? 'sm:col-span-2' : ''">
          <FieldSettingControl
            :spec="spec"
            :field="field"
            :index="index"
            :read-only="readOnly"
            :candidate-types="candidateTypes"
            :candidate-templates="candidateTemplates"
            :options-text="optionsText"
            :accept-list="acceptList"
            @set="setSetting"
            @toggle-type="toggleType"
            @toggle-template="toggleTemplate"
            @update:options-text="optionsText = $event"
            @update:accept-list="acceptList = $event"
          />
        </div>
      </div>
    </section>

    <section v-if="isRepeater">
      <FieldList
        ref="subList"
        nested
        :fields="subFields"
        :field-types="subFieldTypes"
        :read-only="readOnly"
        :saved="savedSubFields"
        :error-for="scoped(errorFor, ['settings'])"
        :error-under="errorUnder ? scopedUnder(errorUnder, ['settings']) : undefined"
        :id-base="`${index}`"
        :depth="(depth ?? 0) + 1"
        @add="addSubField"
        @remove="removeSubField"
        @move="moveSubField"
        @update="updateSubField"
      />
    </section>

    <section>
      <p class="mb-eyebrow mb-2">Rules</p>
      <div class="grid gap-2" :class="isSubField ? '' : 'sm:grid-cols-3'">
        <CheckCard
          v-for="flag in flags"
          :key="flag.key"
          bordered
          :model-value="field[flag.key]"
          :title="flag.label"
          :hint="flag.hint"
          :disabled="readOnly"
          @update:model-value="field = { ...field, [flag.key]: $event }"
        />
      </div>
      <div v-if="ruleSpecs.length" class="mt-3 grid gap-3 sm:grid-cols-2">
        <div v-for="spec in ruleSpecs" :key="spec.key" :class="spec.wide ? 'sm:col-span-2' : ''">
          <FieldSettingControl
            :spec="spec"
            :field="field"
            :index="index"
            :read-only="readOnly"
            :candidate-types="candidateTypes"
            :candidate-templates="candidateTemplates"
            :options-text="optionsText"
            :accept-list="acceptList"
            @set="setSetting"
            @toggle-type="toggleType"
            @toggle-template="toggleTemplate"
            @update:options-text="optionsText = $event"
            @update:accept-list="acceptList = $event"
          />
        </div>
      </div>
      <p v-if="errorFor(['settings'])" class="mb-error mt-2">{{ errorFor(['settings']) }}</p>
    </section>

    <section v-if="pluginSettings">
      <p class="mb-eyebrow mb-2">Settings</p>
      <component
        :is="pluginSettings"
        :settings="field.settings"
        :field="field"
        :read-only="readOnly"
        @update:settings="field = { ...field, settings: $event }"
      />
    </section>

    <section>
      <p class="mb-eyebrow mb-2">In the editor</p>
      <div class="grid gap-3 sm:grid-cols-2">
        <div v-if="!isSubField">
          <span class="mb-label" :id="`field-${index}-zone-label`">Placement</span>
          <SegmentedControl
            :model-value="field.admin.zone"
            :options="ZONES"
            :columns="2"
            :disabled="readOnly"
            :labelledby="`field-${index}-zone-label`"
            @update:model-value="setAdmin('zone', $event)"
          />
        </div>
        <div>
          <span class="mb-label" :id="`field-${index}-width-label`">Width</span>
          <SegmentedControl
            :model-value="field.admin.width"
            :options="WIDTHS.map((width) => ({ value: width, label: `${width}%` }))"
            :columns="4"
            :disabled="readOnly"
            :labelledby="`field-${index}-width-label`"
            @update:model-value="setAdmin('width', $event)"
          />
          <p class="mb-hint">Of the column; two 50% fields share a row.</p>
        </div>
        <TextField
          :id="`field-${index}-placeholder`"
          label="Placeholder"
          :model-value="field.admin.placeholder ?? ''"
          :disabled="readOnly"
          @update:model-value="setAdmin('placeholder', String($event ?? '') || undefined)"
        />
        <TextField
          :id="`field-${index}-help`"
          label="Help text"
          :model-value="field.admin.help ?? ''"
          :disabled="readOnly"
          placeholder="Shown under the input"
          @update:model-value="setAdmin('help', String($event ?? '') || undefined)"
        />
      </div>
    </section>
  </div>
</template>
