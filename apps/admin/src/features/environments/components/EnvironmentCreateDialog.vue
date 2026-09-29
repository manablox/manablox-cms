<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { MODES } from '@manablox/admin-sdk/features/environments/model';
import {
  type Environment,
  type EnvironmentMode,
  environments,
} from '@manablox/admin-sdk/features/environments/queries';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { PRODUCTION_ENVIRONMENT, technicalName } from '@manablox/core';
import { computed } from 'vue';
import { useDerivedName } from '~/composables/useDerivedName';

/** Copies an environment into a new staging one. */
const props = defineProps<{ environments: readonly Environment[] }>();
const emit = defineEmits<{ close: [] }>();

interface Draft {
  name: string;
  machineName: string;
  from: string;
  mode: EnvironmentMode;
}

const form = useDraftForm<Draft>();
form.load({ name: '', machineName: '', from: PRODUCTION_ENVIRONMENT, mode: 'config' });
const draft = form.draft;
const derived = useDerivedName({
  read: () => draft.value?.machineName ?? '',
  write: (value) => {
    if (draft.value) draft.value.machineName = value;
  },
});

function onNameInput(value: string) {
  if (!draft.value) return;
  draft.value.name = value;
  derived.onLabelInput(value);
}

const sources = computed(() =>
  props.environments.map((environment) => ({
    value: environment.machineName,
    label: environment.name,
    hint: environment.machineName,
  })),
);
const modes = (Object.keys(MODES) as EnvironmentMode[]).map((value) => ({
  value,
  title: MODES[value].label,
  hint: MODES[value].create,
}));
const others = computed(() => form.otherErrors([['name'], ['machineName'], ['from'], ['mode']]));

/** Resolves true once created, which closes the dialog. */
async function create(): Promise<boolean> {
  const current = draft.value;
  if (!current?.name.trim()) return false;
  const machineName = technicalName(current.machineName || current.name, { final: true });
  const ok = await form.submit(async () => {
    await environments.create({
      spaceId: requireSpace(),
      name: current.name.trim(),
      machineName,
      from: current.from,
      mode: current.mode,
    });
  });
  if (!ok) return false;
  toast.success(`Created "${current.name.trim()}"`);
  return true;
}
</script>

<template>
  <FormDialog
    v-if="draft"
    title="New environment"
    width="max-w-2xl"
    submit-label="Create environment"
    busy-label="Creating..."
    :busy="form.saving.value"
    :disabled="!draft.name.trim()"
    form-class="grid gap-4 sm:grid-cols-2"
    @submit="create"
    @close="emit('close')"
  >
    <TextField
      label="Name"
      :model-value="draft.name"
      placeholder="Staging"
      required
      :error="form.fieldError(['name'])"
      @update:model-value="onNameInput(String($event ?? ''))"
    />
    <TextField
      label="Technical name"
      :model-value="draft.machineName"
      class="mb-input-mono"
      placeholder="staging"
      :error="form.fieldError(['machineName'])"
      @update:model-value="derived.onNameInput(String($event ?? ''))"
      @blur="derived.onNameBlur()"
    >
      <template v-if="!form.fieldError(['machineName'])" #hint>
        <p class="mb-hint">In the address bar and API requests: <code class="font-mono">?env={{ draft.machineName || 'staging' }}</code>.</p>
      </template>
    </TextField>
    <FormField v-slot="{ id }" label="Copy from" class="sm:col-span-2" :error="form.fieldError(['from'])">
      <Select :id="id" v-model="draft.from" :options="sources" />
    </FormField>
    <fieldset class="sm:col-span-2">
      <legend class="mb-label">What to copy</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <RadioCard
          v-for="entry in modes"
          :key="entry.value"
          v-model="draft.mode"
          name="environment-mode"
          :value="entry.value"
          :title="entry.title"
          :hint="entry.hint"
        />
      </div>
      <p class="mb-hint mt-2">Members, roles, assets, tags, credentials and what plugins keep for the whole space are shared by every environment.</p>
    </fieldset>
    <p v-for="message in others" :key="message" class="mb-error sm:col-span-2">{{ message }}</p>
  </FormDialog>
</template>
