<script setup lang="ts">
import {
  ChipFieldset,
  CopyField,
  CredentialPicker,
  FormDialog,
  FormField,
  Icon,
  KeyValueList,
  Select,
  TextField,
  toast,
  useDraftForm,
} from '@manablox/admin-sdk';
import {
  CONTENT_EVENT_LABELS,
  CONTENT_EVENTS,
  type ContentEvent,
  SIGNATURE_ALGORITHMS,
  SIGNATURE_FORMATS,
  type SignatureAlgorithm,
  type SignatureFormat,
} from '@manablox/core';
import { computed } from 'vue';
import {
  WEBHOOK_AUTH_CREDENTIAL_KIND,
  WEBHOOK_AUTH_MODE_LABELS,
  WEBHOOK_AUTH_MODES_BY_DIRECTION,
  WEBHOOK_METHODS,
  WEBHOOK_SIGNATURE_FORMAT_LABELS,
  type WebhookAuthMode,
  type WebhookDirection,
  type WebhookMethod,
} from '../../sdk';
import { PAYLOAD_PLACEHOLDER } from '../model';
import { webhooks as actions, type Webhook } from '../queries';
import { useWorkflowsApi } from '../useWorkflowsApi';

/** Adds or edits an endpoint; the direction is fixed at creation. Secrets come from vault credentials. */
const props = defineProps<{
  /** The endpoint being edited, or null to add one of `direction`. */
  webhook: Webhook | null;
  direction: WebhookDirection;
  spaceId: string;
}>();
const emit = defineEmits<{ close: []; saved: [webhook: Webhook] }>();

const incoming = computed(() => props.direction === 'incoming');
/** Whether anything runs incoming calls, the workflows plugin being the one that does. */
const workflows = useWorkflowsApi();

interface WebhookDraft {
  name: string;
  description: string;
  url: string;
  events: ContentEvent[];
  headers: Array<{ name: string; value: string }>;
  methods: WebhookMethod[];
  auth: {
    mode: WebhookAuthMode;
    credentialId: string | null;
    signatureHeader: string;
    algorithm: SignatureAlgorithm;
    format: SignatureFormat;
  };
}

const form = useDraftForm<WebhookDraft>();
form.load({
  name: props.webhook?.name ?? '',
  description: props.webhook?.description ?? '',
  url: props.webhook?.url ?? '',
  events: [...((props.webhook?.events ?? []) as ContentEvent[])],
  headers: [...(props.webhook?.headers ?? []), { name: '', value: '' }],
  methods: [...(props.webhook?.methods ?? ['POST'])],
  auth: {
    mode: props.webhook?.auth.mode ?? 'none',
    credentialId: props.webhook?.auth.credentialId ?? null,
    signatureHeader: props.webhook?.auth.signatureHeader ?? 'x-manablox-signature',
    algorithm: props.webhook?.auth.algorithm ?? 'sha256',
    format: props.webhook?.auth.format ?? 'prefixed',
  },
});
const draft = form.draft;
const errorFor = form.fieldError;

/** Errors of fields this dialog has no input for. */
const otherErrors = computed(() =>
  form.otherErrors([['name'], ['url'], ['auth', 'credentialId'], ['auth', 'signatureHeader']]),
);

/** Auth mode labels differ by direction: outgoing describes what the request carries. */
const describe = (mode: WebhookAuthMode) =>
  !incoming.value && mode === 'none'
    ? 'The request carries no authentication.'
    : WEBHOOK_AUTH_MODE_LABELS[mode].description;

const modes = computed(() =>
  WEBHOOK_AUTH_MODES_BY_DIRECTION[props.direction].map((id) => ({
    value: id,
    label: WEBHOOK_AUTH_MODE_LABELS[id].label,
    hint: describe(id),
  })),
);

/** The credential kind the chosen mode needs. */
const wantedKind = computed(() =>
  draft.value ? WEBHOOK_AUTH_CREDENTIAL_KIND[draft.value.auth.mode] : null,
);

const EVENTS = CONTENT_EVENTS.map((event) => ({
  value: event,
  label: CONTENT_EVENT_LABELS[event].label,
}));
const METHODS = WEBHOOK_METHODS.map((method) => ({ value: method, label: method }));
const algorithms = SIGNATURE_ALGORITHMS.map((id) => ({ value: id, label: id }));
const formats = SIGNATURE_FORMATS.map((id) => ({
  value: id,
  label: WEBHOOK_SIGNATURE_FORMAT_LABELS[id],
}));

function setMode(mode: WebhookAuthMode) {
  // The new mode needs a different credential kind.
  if (draft.value) draft.value.auth = { ...draft.value.auth, mode, credentialId: null };
}

function save() {
  const current = draft.value;
  if (!current) return false;
  return form.submit(async () => {
    const input = {
      spaceId: props.spaceId,
      direction: props.direction,
      name: current.name,
      description: current.description || null,
      ...(incoming.value
        ? { methods: current.methods.length ? current.methods : ['POST' as const] }
        : {
            url: current.url,
            events: current.events,
            headers: current.headers.filter((header) => header.name.trim()),
          }),
      auth: current.auth,
    };
    const saved = props.webhook
      ? await actions.update({ ...input, id: props.webhook.id })
      : await actions.create(input);
    toast.success(`Saved "${saved.name}"`);
    emit('saved', saved);
  });
}
</script>

<template>
  <FormDialog
    :title="webhook ? `Edit ${webhook.name}` : incoming ? 'New incoming webhook' : 'New outgoing webhook'"
    form-class="wh:space-y-5"
    :busy="form.saving.value"
    :disabled="!draft?.name.trim()"
    @submit="save"
    @close="emit('close')"
  >
    <template v-if="draft">
      <p class="mb-callout wh:text-xs">
        <template v-if="incoming && workflows">
          A URL another system calls. Every workflow whose trigger points at it runs, with
          what arrived available as
          <code class="wh:font-mono">{{ PAYLOAD_PLACEHOLDER }}</code>.
        </template>
        <template v-else-if="incoming">
          A URL another system calls. Each call is checked and logged; nothing runs it unless a
          plugin listens.
        </template>
        <template v-else>
          A URL this space calls when content changes. The body is JSON:
          the event, what it happened to, and when.
        </template>
      </p>

      <TextField
        v-model="draft.name"
        label="Name"
        :placeholder="incoming ? 'From the shop' : 'Rebuild the site'"
        :error="errorFor(['name'])"
      />

      <TextField v-model="draft.description" label="What it is for" placeholder="Optional. A sentence for whoever finds it next." />

      <TextField v-if="!incoming" v-model="draft.url" label="URL" class="mb-input-mono" placeholder="https://" :error="errorFor(['url'])" />
      <CopyField
        v-else-if="webhook?.endpoint"
        :value="webhook.endpoint"
        label="The URL to hand out"
        hint="Renaming the endpoint does not change it: the address is the slug it was created with."
        url
      />

      <ChipFieldset v-if="!incoming" v-model="draft.events" legend="Send on" :options="EVENTS" hint="Nothing chosen means every event." />
      <ChipFieldset v-else v-model="draft.methods" legend="Accepted methods" :options="METHODS" mono hint="Nothing chosen means POST alone." />

      <section class="wh:space-y-3 wh:rounded-card wh:border wh:border-surface-200 wh:p-3 wh:dark:border-surface-800">
        <FormField :label="incoming ? 'A caller proves itself with' : 'Authenticate with'" :hint="describe(draft.auth.mode)" v-slot="{ id }">
          <Select :id="id" :model-value="draft.auth.mode" :options="modes" @update:model-value="setMode($event)" />
        </FormField>

        <CredentialPicker
          v-if="wantedKind"
          v-model="draft.auth.credentialId"
          :kinds="[wantedKind]"
          :space-id="spaceId"
          :error="errorFor(['auth', 'credentialId'])"
          hint="Stored encrypted; it never comes back to this browser."
        />

        <div v-if="draft.auth.mode === 'hmac'" class="wh:grid wh:gap-3 wh:sm:grid-cols-3">
          <TextField
            v-model="draft.auth.signatureHeader"
            label="Signature header"
            field-class="wh:sm:col-span-3"
            class="mb-input-mono"
            placeholder="x-manablox-signature"
            :error="errorFor(['auth', 'signatureHeader'])"
          />
          <FormField label="Digest" v-slot="{ id }">
            <Select :id="id" v-model="draft.auth.algorithm" :options="algorithms" />
          </FormField>
          <FormField label="Written as" class="wh:sm:col-span-2" v-slot="{ id }">
            <Select :id="id" v-model="draft.auth.format" :options="formats" />
          </FormField>
          <p v-if="incoming" class="mb-meta wh:sm:col-span-3">
            Both spellings of the same digest are accepted, so a service that sends the bare
            hex where this says prefixed still gets through.
          </p>
        </div>
      </section>

      <div v-if="!incoming">
        <span class="mb-label">Extra headers</span>
        <KeyValueList
          v-model="draft.headers"
          label="Header"
          :read-only="false"
          name-placeholder="x-source"
          value-placeholder="value"
        />
      </div>

      <div v-if="otherErrors.length" class="mb-callout wh:text-xs" role="alert">
        <p v-for="message in otherErrors" :key="message">{{ message }}</p>
      </div>
    </template>
  </FormDialog>
</template>
