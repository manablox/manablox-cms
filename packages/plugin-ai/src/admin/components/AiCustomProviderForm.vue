<script setup lang="ts">
import {
  Checkbox,
  FormField,
  Icon,
  NumberField,
  SaveButton,
  Select,
  TextareaField,
  TextField,
  toast,
  useDraftForm,
} from '@manablox/admin-sdk';
import { technicalName } from '@manablox/core';
import { computed, reactive, ref, watch } from 'vue';
import { AI_CUSTOM_DEFAULTS, AI_DEFAULT_SYSTEM_PROMPTS } from '../../sdk';
import { type AiProvider, aiProviders } from '../queries';
import { useProviderActions } from '../useProviderActions';

/** A self-hosted model's endpoint, protocol and capabilities. Without `saved` it creates one; the slug is then fixed. */
const props = defineProps<{
  spaceId: string;
  saved?: AiProvider | undefined;
  canConfigure: boolean;
  /** Slugs already taken in this space. */
  taken: string[];
}>();
const emit = defineEmits<{ done: [] }>();

const form = useDraftForm<Record<string, never>>();
const { saving } = form;

const isNew = computed(() => !props.saved);
const label = ref('');
const slug = ref('');
const slugTouched = ref(false);
const apiKey = ref('');
const systemPrompt = ref('');
const enabled = ref(true);
const models = reactive({ text: '', image: '' });
const config = reactive({
  baseUrl: AI_CUSTOM_DEFAULTS.baseUrl,
  api: AI_CUSTOM_DEFAULTS.api as 'openai' | 'ollama',
  text: true,
  image: false,
  json: AI_CUSTOM_DEFAULTS.json,
  maxOutputTokens: null as number | null,
  contextWindow: null as number | null,
  timeoutSeconds: (AI_CUSTOM_DEFAULTS.timeoutSeconds ?? 300) as number | null,
});
const { testing, tested, runTest, disconnect } = useProviderActions({
  spaceId: () => props.spaceId,
  ref: () => props.saved?.ref ?? null,
  label: () => props.saved?.label ?? '',
  removeMessage: 'The endpoint and any stored key are deleted. Anything already generated stays.',
});

watch(
  () => props.saved,
  (row) => {
    label.value = row?.label ?? '';
    slug.value = row?.slug ?? '';
    apiKey.value = '';
    systemPrompt.value = row?.systemPrompt ?? '';
    enabled.value = row?.enabled ?? true;
    models.text = row?.models?.text ?? '';
    models.image = row?.models?.image ?? '';
    const stored = row?.config;
    config.baseUrl = stored?.baseUrl ?? AI_CUSTOM_DEFAULTS.baseUrl;
    config.api = stored?.api ?? 'openai';
    config.text = stored ? stored.capabilities.includes('text') : true;
    config.image = stored ? stored.capabilities.includes('image') : false;
    config.json = stored?.json ?? true;
    config.maxOutputTokens = stored?.maxOutputTokens ?? null;
    config.contextWindow = stored?.contextWindow ?? null;
    config.timeoutSeconds = stored?.timeoutSeconds ?? AI_CUSTOM_DEFAULTS.timeoutSeconds ?? 300;
    tested.value = null;
  },
  { immediate: true },
);

/** A new model's slug follows the name until edited. */
function onLabel(value: string) {
  label.value = value;
  if (isNew.value && !slugTouched.value) slug.value = slugFor(value);
}
const slugFor = (value: string) =>
  technicalName(value, { final: true }).replace(/_/g, '-').slice(0, 40);

const slugProblem = computed(() => {
  if (!isNew.value) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug.value)) {
    return 'Lowercase letters, digits and hyphens, starting with a letter or digit.';
  }
  return props.taken.includes(slug.value) ? 'Another self-hosted model already uses it.' : null;
});

const API_OPTIONS = [
  {
    value: 'openai',
    label: 'OpenAI-compatible',
    hint: 'Ollama under /v1, LM Studio, vLLM, LocalAI, llama.cpp, most gateways',
  },
  {
    value: 'ollama',
    label: 'Ollama (native)',
    hint: 'Adds the context window and a strict JSON mode',
  },
];

const baseUrlHint = computed(() =>
  config.api === 'ollama'
    ? 'The server root, e.g. http://ollama:11434.'
    : 'Up to the version segment, e.g. http://ollama:11434/v1 or http://gpu-box:8000/v1.',
);

const ready = computed(
  () =>
    Boolean(label.value.trim() && config.baseUrl.trim()) &&
    (config.text || config.image) &&
    !slugProblem.value,
);

const whole = (value: number | null) =>
  value && Number.isFinite(value) && value > 0 ? Math.round(value) : null;

async function submit() {
  if (!ready.value) return;
  await form.submit(async () => {
    await aiProviders.save({
      spaceId: props.spaceId,
      kind: 'custom',
      slug: slug.value,
      label: label.value.trim(),
      enabled: enabled.value,
      // An untouched field keeps the stored key; sending '' would clear it.
      ...(apiKey.value ? { apiKey: apiKey.value } : {}),
      models: {
        ...(config.text && models.text.trim() ? { text: models.text.trim() } : {}),
        ...(config.image && models.image.trim() ? { image: models.image.trim() } : {}),
      },
      systemPrompt: systemPrompt.value,
      config: {
        baseUrl: config.baseUrl.trim(),
        api: config.api,
        capabilities: [
          ...(config.text ? (['text'] as const) : []),
          ...(config.image ? (['image'] as const) : []),
        ],
        json: config.json,
        maxOutputTokens: whole(config.maxOutputTokens),
        contextWindow: config.api === 'ollama' ? whole(config.contextWindow) : null,
        timeoutSeconds: whole(config.timeoutSeconds),
      },
    });
    apiKey.value = '';
    tested.value = null;
    toast.success(`${label.value.trim()} saved`);
    if (isNew.value) emit('done');
  });
}
</script>

<template>
  <div class="ai:space-y-4">
    <div class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
      <TextField
        label="Name"
        :model-value="label"
        placeholder="Ollama on the GPU box"
        :disabled="!canConfigure"
        @update:model-value="onLabel(String($event ?? ''))"
      />
      <TextField
        v-model="slug"
        label="Slug"
        class="mb-input-mono"
        :disabled="!canConfigure || !isNew"
        :error="slugProblem"
        :hint="slugProblem ? undefined : `How workflows and the API name it: custom:${slug || '...'}`"
        @input="slugTouched = true"
      />
      <FormField label="Speaks" v-slot="{ id }">
        <Select :id="id" v-model="config.api" :options="API_OPTIONS" :disabled="!canConfigure" />
      </FormField>
      <TextField v-model="config.baseUrl" label="Base URL" type="url" class="mb-input-mono" :disabled="!canConfigure" :hint="baseUrlHint" />
    </div>

    <fieldset>
      <legend class="mb-label">What it can do</legend>
      <div class="ai:grid ai:gap-3 ai:sm:grid-cols-2">
        <div class="ai:space-y-2">
          <Checkbox v-model="config.text" :disabled="!canConfigure">Write text</Checkbox>
          <TextField
            v-if="config.text"
            v-model="models.text"
            class="mb-input-mono"
            placeholder="llama3.1, qwen3:14b, mistral-small"
            aria-label="Text model"
            :disabled="!canConfigure"
          />
        </div>
        <div class="ai:space-y-2">
          <Checkbox v-model="config.image" :disabled="!canConfigure || config.api === 'ollama'">Draw pictures</Checkbox>
          <TextField
            v-if="config.image && config.api === 'openai'"
            v-model="models.image"
            class="mb-input-mono"
            placeholder="stable-diffusion-xl, flux-schnell"
            aria-label="Image model"
            :disabled="!canConfigure"
          />
          <p v-if="config.api === 'ollama'" class="mb-hint">
            Pictures need an OpenAI-compatible images endpoint.
          </p>
        </div>
      </div>
      <Checkbox v-model="config.json" :disabled="!canConfigure" class="ai:mt-3">Can be held to a JSON answer</Checkbox>
      <p class="mb-hint">
        Whole documents, content type designs and workflow designs are JSON. Untick it for a
        server that refuses JSON mode; answers are still read leniently.
      </p>
    </fieldset>

    <div class="ai:grid ai:gap-3 ai:sm:grid-cols-3">
      <NumberField
        v-model="config.maxOutputTokens"
        label="Longest answer"
        nullable
        :min="1"
        placeholder="server default"
        :disabled="!canConfigure"
        hint="Tokens."
      />
      <NumberField
        v-if="config.api === 'ollama'"
        v-model="config.contextWindow"
        label="Context window"
        nullable
        :min="1"
        placeholder="server default"
        :disabled="!canConfigure"
        hint="Tokens. Designs need 16k or more."
      />
      <NumberField
        v-model="config.timeoutSeconds"
        label="Wait at most"
        nullable
        :min="5"
        :max="3600"
        :disabled="!canConfigure"
        hint="Seconds. Local models on modest hardware are slow."
      />
    </div>

    <TextField
      v-model="apiKey"
      label="API key (optional)"
      type="password"
      class="mb-input-mono"
      autocomplete="off"
      :disabled="!canConfigure"
      :placeholder="saved?.hasKey ? `Stored, ending ${saved.apiKeyHint}. Leave empty to keep it.` : 'Only if the server asks for one'"
    />

    <TextareaField
      v-model="systemPrompt"
      label="System prompt"
      class="ai:min-h-24"
      :placeholder="AI_DEFAULT_SYSTEM_PROMPTS.custom"
      :disabled="!canConfigure"
      maxlength="8000"
    />

    <Checkbox v-model="enabled" :disabled="!canConfigure">Offer this model in the editor</Checkbox>

    <div class="ai:flex ai:flex-wrap ai:items-center ai:gap-2">
      <SaveButton v-if="canConfigure" :saving="saving" :disabled="!ready" @click="submit" />
      <button v-if="isNew" type="button" class="mb-btn-ghost" @click="emit('done')">Cancel</button>
      <SaveButton
        v-if="canConfigure && saved"
        :saving="testing"
        icon="zap"
        variant="outline"
        label="Test the connection"
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
