<script setup lang="ts">
import {
  Accordion,
  Checkbox,
  FormField,
  Icon,
  SaveButton,
  Select,
  TextareaField,
  TextField,
  toast,
  useDraftForm,
} from '@manablox/admin-sdk';
import { computed, reactive, ref, watch } from 'vue';
import {
  AI_DEFAULT_SYSTEM_PROMPTS,
  type AiCapability,
  type AiModelMap,
  type AiProviderKind,
  type AiProviderMeta,
  styleGroupsFor,
} from '../../sdk';
import { aiProviders } from '../queries';
import { useProviderActions } from '../useProviderActions';

/** One provider's settings. The key is write-only: shown as its last four characters, kept when left empty. */
const props = defineProps<{
  spaceId: string;
  meta: AiProviderMeta;
  /** What the space has stored for this provider, if anything. */
  saved:
    | {
        kind: AiProviderKind;
        enabled: boolean;
        hasKey: boolean;
        apiKeyHint: string | null;
        models: AiModelMap;
        systemPrompt: string;
        defaults: Record<string, string>;
      }
    | undefined;
  canConfigure: boolean;
}>();

const form = useDraftForm<Record<string, never>>();
const { saving } = form;

const enabled = ref(false);
const apiKey = ref('');
const systemPrompt = ref('');
const models = reactive<Record<string, string>>({});
const defaults = reactive<Record<string, string>>({});
const { testing, tested, runTest, disconnect } = useProviderActions({
  spaceId: () => props.spaceId,
  ref: () => props.meta.kind,
  label: () => props.meta.label,
  removeMessage: 'The stored key is deleted. Anything already generated stays where it is.',
});

/** Style pickers for this provider's jobs, so the space sets the dialog's defaults. Declared before the immediate watch that reads it. */
const styleGroups = computed(() =>
  props.meta.capabilities.flatMap((capability) => styleGroupsFor(capability)),
);
const styleOptions = (group: {
  optional: boolean;
  options: readonly { id: string; label: string }[];
}) => {
  const options = group.options.map((option) => ({ value: option.id, label: option.label }));
  return group.optional ? [{ value: '', label: 'No preference' }, ...options] : options;
};

/** Loads stored settings, or the provider's defaults. */
watch(
  () => props.saved,
  (row) => {
    enabled.value = row?.enabled ?? false;
    apiKey.value = '';
    systemPrompt.value = row?.systemPrompt ?? '';
    tested.value = null;
    for (const capability of props.meta.capabilities) {
      models[capability] = row?.models?.[capability] ?? props.meta.defaultModels[capability] ?? '';
    }
    for (const group of styleGroups.value) {
      defaults[group.id] = row?.defaults?.[group.id] ?? '';
    }
  },
  { immediate: true },
);

const placeholder = computed(() => AI_DEFAULT_SYSTEM_PROMPTS[props.meta.kind] ?? '');

/** The provider's models for a job, labelled by name with the API id alongside. */
const modelOptions = (capability: AiCapability) =>
  (props.meta.models[capability] ?? []).map((model) => ({
    value: model.id,
    label: model.label,
    hint: model.hint ? `${model.id} - ${model.hint}` : model.id,
  }));

/** Only this provider's capabilities that have a model chosen. */
function modelsToSave(): AiModelMap {
  const out: AiModelMap = {};
  for (const capability of props.meta.capabilities) {
    const model = models[capability];
    if (model) out[capability] = model;
  }
  return out;
}

async function submit() {
  await form.submit(async () => {
    await aiProviders.save({
      spaceId: props.spaceId,
      kind: props.meta.kind,
      enabled: enabled.value,
      // An untouched field keeps the stored key; sending '' would clear it.
      ...(apiKey.value ? { apiKey: apiKey.value } : {}),
      models: modelsToSave(),
      systemPrompt: systemPrompt.value,
      defaults: Object.fromEntries(Object.entries(defaults).filter(([, value]) => value)) as Record<
        string,
        string
      >,
    });
    apiKey.value = '';
    tested.value = null;
    toast.success(`${props.meta.label} saved`);
  });
}
</script>

<template>
  <div class="ai:space-y-4">
    <div class="ai:grid ai:gap-4 ai:md:grid-cols-2">
      <TextField
        v-model="apiKey"
        :label="meta.credentialLabel"
        type="password"
        class="mb-input-mono"
        autocomplete="off"
        :disabled="!canConfigure"
        :placeholder="saved?.hasKey ? `Stored, ending ${saved.apiKeyHint}. Leave empty to keep it.` : meta.credentialHint"
        hint="Stored encrypted with the instance secret, and never shown again."
      />

      <FormField v-for="capability in meta.capabilities" :key="capability" :label="`Model for ${capability}`" v-slot="{ id }">
        <Select
          v-if="modelOptions(capability).length"
          :id="id"
          :model-value="models[capability] ?? ''"
          :options="modelOptions(capability)"
          :disabled="!canConfigure"
          @update:model-value="models[capability] = $event"
        />
      </FormField>
    </div>

    <TextareaField
      v-model="systemPrompt"
      label="System prompt"
      class="ai:min-h-28"
      :placeholder="placeholder"
      :disabled="!canConfigure"
      maxlength="8000"
      hint="Sent before every prompt, to hold generations to the house style. Empty uses the default shown."
    />

    <Accordion v-if="styleGroups.length" :items="[{ value: 'defaults', label: 'What the dialog opens on' }]">
      <div class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
        <FormField v-for="group in styleGroups" :key="group.id" :label="group.label" v-slot="{ id }">
          <Select
            :id="id"
            :model-value="defaults[group.id] ?? ''"
            :options="styleOptions(group)"
            :disabled="!canConfigure"
            @update:model-value="defaults[group.id] = $event"
          />
        </FormField>
      </div>
    </Accordion>

    <Checkbox v-model="enabled" :disabled="!canConfigure">Offer this provider in the editor</Checkbox>

    <div class="ai:flex ai:flex-wrap ai:items-center ai:gap-2">
      <SaveButton v-if="canConfigure" :saving="saving" @click="submit" />
      <SaveButton
        v-if="canConfigure && saved?.hasKey"
        :saving="testing"
        icon="zap"
        variant="outline"
        label="Test the key"
        @click="runTest"
      />
      <span v-if="tested === 'ok'" class="mb-badge-ok">Answered</span>
      <span v-if="tested === 'failed'" class="mb-badge-danger">No answer</span>
      <button
        v-if="canConfigure && saved"
        type="button"
        class="mb-btn-ghost-danger ai:ml-auto"
        @click="disconnect"
      >
        <Icon name="trash" /> Remove
      </button>
    </div>
  </div>
</template>
