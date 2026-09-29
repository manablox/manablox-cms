<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EditorHeader from '@manablox/admin-sdk/components/layout/EditorHeader.vue';
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import { type EditorForm, useEditorForm } from '@manablox/admin-sdk/composables/useEditorForm';
import { contentTypes } from '@manablox/admin-sdk/features/content-types/queries';
import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';
import { plainClone } from '@manablox/admin-sdk/lib/clone';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import EditorLayout from '~/components/layout/EditorLayout.vue';
import PluginSlot from '~/components/PluginSlot';
import { useDerivedName } from '~/composables/useDerivedName';
import { useFocusFirstField } from '~/composables/useFocusFirstField';
import BuiltInFields from '~/features/content-types/components/BuiltInFields.vue';
import FieldList from '~/features/content-types/components/FieldList.vue';
import TypeBehaviourSection from '~/features/content-types/components/TypeBehaviourSection.vue';
import TypeIdentitySection from '~/features/content-types/components/TypeIdentitySection.vue';
import TypePresetPicker from '~/features/content-types/components/TypePresetPicker.vue';
import {
  type ContentTypeDraft,
  DELETE_WARNINGS,
  describeTypeError,
  erroredFields,
  errorUnderOf,
  isInlineTypeError,
  KIND_LABELS,
  moveField,
  nameUnnamedFields,
  newField,
  typeFlags,
} from '~/features/content-types/model';
import { useTypePreset } from '~/features/content-types/useTypePreset';
import { useTypeRoute } from '~/features/content-types/useTypeRoute';

const router = useRouter();
const spaces = useSpaceStore();
const { types, section, noun, routedId, existing, newKind, loading, notFound, source } =
  useTypeRoute();

// Typed by its exposed API: a type-only `.vue` import would become `import type` and erase the value.
const fieldList = useTemplateRef<{ open: (id: string) => void; reveal: (id: string) => void }>(
  'fieldList',
);

const form: EditorForm<ContentTypeDraft> = useEditorForm<ContentTypeDraft, ContentTypeDraft>({
  source,
  toDraft: plainClone,
  what: () => `This ${noun.value}`,
  crumb: (draft) => (draft.id ? draft.label : `New ${noun.value}`),
  save: () => save(),
  inline: isInlineTypeError,
  describe: (detail): string => describeTypeError(form.draft.value, detail),
});
const { draft, isDirty, saving, otherErrors } = form;
const errorFor = form.fieldError;

const readOnly = computed(() => existing.value?.source === 'code');
/** Saved fields; their names are in the GraphQL schema, so they are locked. */
const savedFields = computed(() => existing.value?.fields ?? []);
const isBlock = computed(() => draft.value?.kind === 'block');
const isData = computed(() => draft.value?.kind === 'data');
const eyebrow = computed(() => {
  if (!draft.value) return '';
  if (draft.value.id) return KIND_LABELS[draft.value.kind];
  return isData.value ? 'Databag types' : 'Content types';
});

/** The name follows the label until edited by hand; never for a saved type. */
const derived = useDerivedName({
  read: () => draft.value?.name ?? '',
  write: (value) => {
    if (draft.value) draft.value.name = value;
  },
  follows: (touched) => !touched && !draft.value?.id,
});

function onLabelInput(value: string) {
  if (!draft.value) return;
  draft.value.label = value;
  derived.onLabelInput(value);
}

const onNameInput = (value: string) => derived.onNameInput(value);
const onNameBlur = () => derived.onNameBlur();

const { preset, presets, pickedPlugin, presetDraft, setPresetDraft, resetPreset, choosePreset } =
  useTypePreset(draft, onLabelInput);

// A new type starts attached to its label again.
watch(
  () => [routedId.value, newKind.value] as const,
  ([id]) => {
    if (!id) derived.reset();
    resetPreset();
  },
);

// A new type focuses its label.
useFocusFirstField(useTemplateRef<HTMLElement>('page'), () =>
  Boolean(draft.value && !draft.value.id),
);

// --- fields --------------------------------------------------------------

function addField(typeName: string) {
  if (!draft.value) return;
  const field = newField(typeName, spaces.fieldTypeMeta(typeName), draft.value.fields.length);
  draft.value.fields.push(field);
  fieldList.value?.open(field.id);
}

function removeField(id: string) {
  if (!draft.value) return;
  draft.value.fields = draft.value.fields.filter((field) => field.id !== id);
}

function updateField(index: number, field: FieldDefinition) {
  if (!draft.value) return;
  draft.value.fields[index] = field;
}

function onMoveField(from: number, to: number) {
  if (draft.value) draft.value.fields = moveField(draft.value.fields, from, to);
}

/** Field positions with errors. */
const fieldsWithErrors = computed(() => erroredFields(form.errors.value));
const errorUnder = computed(() => errorUnderOf(form.errors.value));

// --- persistence ---------------------------------------------------------

async function save() {
  if (!draft.value || readOnly.value || !isDirty.value) return;
  const current = draft.value;
  // Into the draft too, so the name inputs show what was saved.
  current.fields = nameUnnamedFields(current.fields);

  const plugin = current.id ? null : pickedPlugin.value;
  const refused = plugin?.entry.validate?.(presetDraft.value);
  if (refused) {
    toast.error(refused);
    return;
  }
  const ok = await form.submit(async () => {
    const payload = {
      spaceId: requireSpace(),
      name: current.name,
      label: current.label || current.name,
      ...(current.icon ? { icon: current.icon } : {}),
      kind: current.kind,
      ...typeFlags(current),
      fields: current.fields,
    };
    const saved = current.id
      ? await contentTypes.update({ ...payload, id: current.id })
      : await contentTypes.create(payload);
    form.markSaved();
    if (plugin) await plugin.entry.afterCreate?.(saved, presetDraft.value);
    toast.success(`Saved "${saved.label}"`);
    await router.replace(`${section.value}/${saved.id}`);
  });
  // Open the first erroring field's settings so its message shows.
  const first = ok ? undefined : Math.min(...fieldsWithErrors.value);
  const field = first === undefined ? undefined : current.fields[first];
  if (field) fieldList.value?.reveal(field.id);
}

async function remove() {
  if (!draft.value?.id) return;
  const { id, label, kind } = draft.value;
  return confirmAndRun(
    {
      title: `Delete this ${noun.value}?`,
      message: DELETE_WARNINGS[kind],
      confirmLabel: `Delete ${noun.value}`,
      danger: true,
    },
    async () => {
      await contentTypes.remove(requireSpace(), id);
      await router.replace(section.value);
    },
    { success: `Deleted "${label}"` },
  );
}
</script>

<template>
  <PageState
    :loading="loading"
    :error="routedId ? types.error.value : null"
    :retry="types.refetch"
    :not-found="notFound"
    :not-found-title="`No such ${noun}`"
    not-found-icon="shapes"
    :back-to="section"
    :back-label="section === '/types' ? 'All content types' : 'All databag types'"
  >
  <div v-if="draft" ref="page" class="mb-page">
    <EditorHeader
      :title="draft.id ? draft.label : `New ${noun}`"
      :eyebrow="eyebrow"
      :eyebrow-icon="draft.id ? typeIcon(draft) : undefined"
    >
      <template #badge>
        <StatusBadge v-if="readOnly" status="read-only" title="Defined in code" />
        <StatusBadge v-else-if="isDirty" status="unsaved" />
      </template>
      <SaveButton v-if="!readOnly" :saving="saving" :disabled="!isDirty" @click="save" />
      <RouterLink v-if="isData && draft.id" :to="`/databags/${draft.id}`" class="mb-btn-ghost" title="Browse this databag's entries">
        <Icon name="database" /> Entries
      </RouterLink>
      <PluginSlot v-if="existing" id="contentType.actions" :props="{ type: existing }" />
      <button v-if="!readOnly && draft.id" type="button" class="mb-btn-ghost-danger" :title="`Delete ${noun}`" @click="remove">
        <Icon name="trash" /> Delete
      </button>
    </EditorHeader>

    <div v-if="errorFor([]) || otherErrors.length" class="mb-callout mb-4" role="alert">
      <p v-if="errorFor([])">{{ errorFor([]) }}</p>
      <p v-for="(message, i) in otherErrors" :key="i">{{ message }}</p>
    </div>

    <EditorLayout>
      <div class="space-y-4">
        <TypePresetPicker
          v-if="presets.length"
          :kind="draft.kind"
          :presets="presets"
          :model-value="preset"
          @update:model-value="choosePreset"
        >
          <component
            :is="pickedPlugin.component"
            v-if="pickedPlugin"
            :draft="presetDraft"
            :set-draft="setPresetDraft"
          />
        </TypePresetPicker>

        <TypeIdentitySection
          :draft="draft"
          :read-only="readOnly"
          :name-error="errorFor(['name'])"
          @label="onLabelInput"
          @name="onNameInput"
          @name-blur="onNameBlur"
        />

        <!-- Block types have none of these. -->
        <BuiltInFields
          v-if="!isBlock"
          :has-slug="draft.hasSlug"
          :is-publishable="draft.isPublishable"
          :can-be-visible-in-menu="draft.canBeVisibleInMenu"
          :in-tree="!isData"
        />

        <FieldList
          ref="fieldList"
          :fields="draft.fields"
          :field-types="spaces.fieldTypes"
          :read-only="readOnly"
          :saved="savedFields"
          :error-for="errorFor"
          :error-under="errorUnder"
          :errored="fieldsWithErrors"
          @add="addField"
          @remove="removeField"
          @move="onMoveField"
          @update="updateField"
        />
      </div>

      <template #aside>
        <TypeBehaviourSection :draft="draft" :read-only="readOnly" />
      </template>
    </EditorLayout>
  </div>
  </PageState>
</template>
