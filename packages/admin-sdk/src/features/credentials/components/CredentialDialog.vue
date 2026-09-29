<script setup lang="ts">
import { CREDENTIAL_KIND_SPECS, CREDENTIAL_KINDS } from '@manablox/core';
import { computed, watch } from 'vue';
import FormDialog from '../../../components/ui/FormDialog.vue';
import FormField from '../../../components/ui/FormField.vue';
import Select from '../../../components/ui/Select.vue';
import TextField from '../../../components/ui/TextField.vue';
import { useDraftForm } from '../../../composables/useDraftForm';
import { toast } from '../../../lib/toast';
import { credentials as actions, type CredentialKind, type CredentialView } from '../queries';

/** Adds or edits a credential. Secrets are write-only; an empty field keeps the stored value. */
const props = defineProps<{
  /** The credential being edited, or null to add one. */
  credential: CredentialView | null;
  spaceId: string;
  /** Restricts the offered kinds. */
  kinds?: CredentialKind[] | undefined;
}>();
const emit = defineEmits<{ close: []; saved: [credential: CredentialView] }>();

const offered = computed(() =>
  (props.kinds?.length ? props.kinds : [...CREDENTIAL_KINDS]).map((id) => ({
    value: id,
    label: CREDENTIAL_KIND_SPECS[id].label,
    hint: CREDENTIAL_KIND_SPECS[id].description,
  })),
);

interface CredentialDraft {
  name: string;
  kind: CredentialKind;
  provider: string;
  data: Record<string, string>;
}

const form = useDraftForm<CredentialDraft>();
form.load({
  name: props.credential?.name ?? '',
  kind: props.credential?.kind ?? offered.value[0]?.value ?? 'apiKey',
  provider: props.credential?.provider ?? '',
  // The server returns only non-secret fields.
  data: { ...(props.credential?.data ?? {}) },
});
const draft = form.draft;
const errorFor = form.fieldError;

const spec = computed(() => CREDENTIAL_KIND_SPECS[draft.value?.kind ?? 'apiKey']);

/** Errors of fields this dialog has no input for. */
const otherErrors = computed(() =>
  form.otherErrors((path) => ['name', 'kind'].includes(String(path[0])) || path[0] === 'data'),
);

// Clear fields when the kind changes during an add.
watch(
  () => draft.value?.kind,
  () => {
    if (!props.credential && draft.value) draft.value.data = {};
  },
);

function save() {
  const current = draft.value;
  if (!current) return false;
  return form.submit(async () => {
    const input = {
      spaceId: props.spaceId,
      name: current.name,
      kind: current.kind,
      provider: current.provider,
      data: current.data,
    };
    const saved = props.credential
      ? await actions.update({ ...input, id: props.credential.id })
      : await actions.create(input);
    toast.success(`Saved "${saved.name}"`);
    emit('saved', saved);
  });
}
</script>

<template>
  <FormDialog
    v-if="draft"
    :title="credential ? `Edit ${credential.name}` : 'Add a credential'"
    form-class="space-y-4"
    :busy="form.saving.value"
    :disabled="!draft.name.trim()"
    @submit="save"
    @close="emit('close')"
  >
    <TextField v-model="draft.name" label="Name" placeholder="Trello, the newsletter account, ..." :error="errorFor(['name'])" />

    <FormField label="Kind" :hint="spec.description" :error="errorFor(['kind'])" v-slot="{ id }">
      <Select :id="id" v-model="draft.kind" :options="offered" :disabled="Boolean(credential)" />
    </FormField>

    <TextField
      v-for="field in spec.fields"
      :key="field.name"
      v-model="draft.data[field.name]"
      :label="field.label"
      :type="field.secret ? 'password' : 'text'"
      :class="field.secret ? 'font-mono text-xs' : ''"
      autocomplete="off"
      :placeholder="credential && field.secret ? 'Unchanged' : field.placeholder"
      :hint="field.hint"
      :error="errorFor(['data', field.name])"
    />

    <p v-if="draft.kind === 'custom'" class="mb-callout text-xs">
      A free-form credential holds whatever a plugin's action asks for. Add its values on
      the action itself.
    </p>
    <p class="mb-meta">
      Stored encrypted with the instance secret. It is never sent back to this browser and
      never written into a run log.
    </p>
    <div v-if="otherErrors.length" class="mb-callout text-xs" role="alert">
      <p v-for="message in otherErrors" :key="message">{{ message }}</p>
    </div>
  </FormDialog>
</template>
