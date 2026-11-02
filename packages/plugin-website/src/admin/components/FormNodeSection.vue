<script setup lang="ts">
import {
  Checkbox,
  ContentPicker,
  confirm,
  FeatureLock,
  FormField,
  Icon,
  Loader,
  Select,
  Switch,
  useContentByIds,
  useFeature,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { collectNodeIds, type DesignNode } from '@manablox/site';
import { computed } from 'vue';
import {
  bindForm,
  boundFieldOf,
  type FormSourceField,
  type FormSourceType,
  formFieldRows,
  formWarnings,
  formWarningText,
  regenerateForm,
  toggleFormField,
} from '../model/form-design';
import { useDesignerContext } from '../useDesignerContext';
import { useSiteContext } from '../useSiteContext';
import LocalizedTextField from './LocalizedTextField.vue';

/** The Content tab of a `form`: its databag type, which fields it asks for, messages and consent. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const spaces = useSpaceStore();
const site = useSiteContext();
const designer = useDesignerContext();
const { locales, locale } = designer;
/** Setting up forms can be locked apart from designing; then the form is read-only. */
const formsConfig = useFeature('plugins.website.forms.config');
const readOnly = computed(() => designer.readOnly.value || !formsConfig.value.enabled);

const types = computed<FormSourceType[]>(() =>
  spaces.dataKinds.map((type) => ({ id: type.id, label: type.label, fields: type.fields })),
);
const typeId = computed(() =>
  typeof props.node.props?.databagTypeId === 'string' ? props.node.props.databagTypeId : '',
);
const type = computed(() => types.value.find((entry) => entry.id === typeId.value) ?? null);

/** Databag fields of the design; a form bound to one stores in the type editors pick there. */
const FIELD_PREFIX = 'field:';
const fields = designer.fields;
const databagFields = computed(() => fields.value.filter((field) => field.type === 'databag'));
const boundId = computed(() => boundFieldOf(props.node));
const boundField = computed(() => fields.value.find((field) => field.id === boundId.value) ?? null);

const typeOptions = computed(() => {
  const list = [
    ...databagFields.value.map((field) => ({
      value: `${FIELD_PREFIX}${field.id}`,
      label: `Picked by editors in the "${field.label || field.name}" field`,
    })),
    ...types.value.map((entry) => ({ value: entry.id, label: entry.label })),
  ];
  if (boundId.value && !boundField.value)
    list.unshift({ value: `${FIELD_PREFIX}${boundId.value}`, label: 'A deleted field' });
  else if (typeId.value && !type.value)
    list.unshift({ value: typeId.value, label: 'A deleted databag type' });
  return list;
});
const choice = computed(() => (boundId.value ? `${FIELD_PREFIX}${boundId.value}` : typeId.value));

const rows = computed(() =>
  type.value && !boundId.value ? formFieldRows(props.node, type.value) : [],
);
const warnings = computed(() =>
  formWarnings(props.node, type.value, {
    formsEnabled: site.settings.data.value?.formsEnabled,
    fields: fields.value,
  }),
);

function update(next: DesignNode, group?: string) {
  if (!readOnly.value) emit('update', next, group);
}

function setProp(key: string, value: unknown) {
  const next = { ...props.node.props };
  if (value === undefined || value === '' || value === null || value === false) delete next[key];
  else next[key] = value;
  update({ ...props.node, props: next }, `props:${props.node.id}:${key}`);
}

/** Ids of the rest of the design, so rebuilt inputs get ids of their own. */
function takenOutside(): Set<string> {
  const all = designer.takenIds();
  for (const id of collectNodeIds(props.node)) if (id !== props.node.id) all.delete(id);
  return all;
}

async function pickType(id: string) {
  if (id === choice.value) return;
  const hasInputs = rows.value.some((row) => row.shown);
  if (id.startsWith(FIELD_PREFIX)) {
    const field = databagFields.value.find((entry) => `${FIELD_PREFIX}${entry.id}` === id);
    if (!field) return;
    if (
      hasInputs &&
      !(await confirm({
        title: 'Let editors pick the databag type?',
        message:
          'The inputs are replaced with one that asks for every field of the type an editor picks. Undo brings them back.',
        confirmLabel: 'Let editors pick',
      }))
    )
      return;
    update(bindForm(props.node, field.id, designer.takenIds()));
    return;
  }
  const next = types.value.find((entry) => entry.id === id);
  if (!next) return;
  if (hasInputs) {
    const ok = await confirm({
      title: `Ask for the fields of "${next.label}"?`,
      message:
        'The inputs are replaced with one per field of the new databag type. Undo brings them back.',
      confirmLabel: 'Switch type',
    });
    if (!ok) return;
  }
  update(regenerateForm(props.node, next, takenOutside(), locale.value));
}

async function regenerate() {
  if (!type.value) return;
  const ok = await confirm({
    title: 'Generate the inputs again?',
    message:
      'Every input, the submit button and the message are rebuilt from the databag type; their styles and texts go. Undo brings them back.',
    confirmLabel: 'Generate',
  });
  if (ok) update(regenerateForm(props.node, type.value, takenOutside(), locale.value));
}

function toggle(field: FormSourceField, show: boolean) {
  const taken = designer.takenIds();
  update(toggleFormField(props.node, field, show, taken, locale.value));
}

// Redirect target.
const redirectId = computed(() =>
  typeof props.node.props?.redirectContentId === 'string' ? props.node.props.redirectContentId : '',
);
const redirectRows = useContentByIds(() => (redirectId.value ? [redirectId.value] : []));
const redirectDoc = computed(() => redirectRows.data.value?.[0] ?? null);
const pageTypeIds = computed(() => spaces.creatableKinds.map((entry) => entry.id));

const labelOf = (field: FormSourceField) => field.label || field.name;
</script>

<template>
  <div class="ws:space-y-4">
    <FeatureLock v-if="formsConfig.locked" feature="plugins.website.forms.config" label="Setting up forms is locked" />
    <FormField
      label="Stores entries in"
      :hint="boundId ? 'Editors pick the databag type in that field; the form asks for all of its fields.' : 'Each submission becomes an entry of this databag type.'"
    >
      <template #default="{ id }">
        <Select
          :id="id"
          :model-value="choice"
          :options="typeOptions"
          placeholder="Pick a databag type"
          :disabled="readOnly || typeOptions.length === 0"
          @update:model-value="pickType"
        />
      </template>
    </FormField>
    <p v-if="types.length === 0" class="mb-hint">
      This space has no databag types yet. <RouterLink to="/databag-types" class="ws:underline">Create one</RouterLink>, e.g. "Contact requests".
    </p>

    <section v-if="type" class="ws:space-y-2">
      <div class="ws:flex ws:items-center ws:justify-between ws:gap-2">
        <span class="mb-label">Fields it asks for</span>
        <button v-if="!readOnly" type="button" class="mb-btn-ghost mb-btn-sm" title="Rebuild the inputs from the databag type" @click="regenerate">
          <Icon name="wand" class="mb-icon-sm" /> Generate fields
        </button>
      </div>
      <ul class="ws:space-y-1">
        <li v-for="row in rows" :key="row.field.id">
          <Checkbox
            :model-value="row.shown"
            :disabled="readOnly || Boolean(row.reason) || row.locked"
            align="start"
            @update:model-value="toggle(row.field, $event)"
          >
            <span class="ws:min-w-0 ws:flex-1">
              <span class="ws:block ws:truncate">{{ labelOf(row.field) }}<span v-if="row.field.required" class="ws:text-danger-600" title="Required"> *</span></span>
              <span v-if="row.reason" class="ws:block ws:text-2xs ws:text-surface-500">Not in forms: {{ row.reason }}</span>
              <span v-else-if="row.locked" class="ws:block ws:text-2xs ws:text-surface-500">Required, so it stays</span>
            </span>
          </Checkbox>
        </li>
      </ul>
    </section>

    <LocalizedTextField
      :model-value="node.props?.successMessage"
      label="Thank-you message"
      hint="Shown after a successful submission."
      :locales="locales"
      :locale="locale"
      :read-only="readOnly"
      @update:model-value="setProp('successMessage', $event)"
    />

    <section class="ws:space-y-2">
      <span class="mb-label">After sending, go to</span>
      <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-2">
        <span v-if="redirectId && redirectDoc" class="mb-badge ws:max-w-full ws:truncate"><Icon name="doc" class="mb-icon-sm" /> {{ redirectDoc.title }}</span>
        <Loader v-else-if="redirectId && redirectRows.isPending.value" inline class="ws:text-sm" />
        <span v-else-if="redirectId" class="mb-badge-warn">The chosen page no longer exists</span>
        <span v-else class="ws:text-sm ws:text-surface-500">Stay on the page and show the message</span>
        <template v-if="!readOnly">
          <ContentPicker :type-ids="pageTypeIds" :label="redirectId ? 'Change' : 'Pick a page'" trigger-class="mb-btn-outline mb-btn-sm" @pick="setProp('redirectContentId', $event.id)" />
          <button v-if="redirectId" type="button" class="mb-btn-ghost mb-btn-sm" @click="setProp('redirectContentId', undefined)">Stay on the page</button>
        </template>
      </div>
    </section>

    <Switch :model-value="node.props?.consent === true" :disabled="readOnly" @update:model-value="setProp('consent', $event)">
      <span class="ws:text-sm">Ask for consent before sending</span>
    </Switch>
    <LocalizedTextField
      v-if="node.props?.consent === true"
      :model-value="node.props?.consentText"
      label="Consent text"
      hint="Next to the checkbox, e.g. how you use the data."
      :locales="locales"
      :locale="locale"
      multiline
      :read-only="readOnly"
      @update:model-value="setProp('consentText', $event)"
    />

    <div v-if="warnings.length" class="ws:space-y-1 ws:rounded-control ws:border ws:border-warn-300 ws:p-3 ws:text-xs ws:dark:border-warn-700" role="status">
      <p class="mb-eyebrow">Check this form</p>
      <ul class="ws:list-disc ws:space-y-0.5 ws:pl-4 ws:text-warn-800 ws:dark:text-warn-200">
        <li v-for="(warning, index) in warnings" :key="index">
          <button
            v-if="'nodeId' in warning"
            type="button"
            class="ws:text-left ws:hover:underline"
            @click="designer.select(warning.nodeId)"
          >
            {{ formWarningText(warning) }}
          </button>
          <template v-else>{{ formWarningText(warning) }}</template>
        </li>
      </ul>
    </div>
  </div>
</template>
