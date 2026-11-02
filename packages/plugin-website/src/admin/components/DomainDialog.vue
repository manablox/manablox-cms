<script setup lang="ts">
import {
  Checkbox,
  FormDialog,
  FormField,
  localeName,
  previewHostname,
  Select,
  TextField,
  toast,
  useDraftForm,
  useEnvironmentChoice,
  useSpaceStore,
} from '@manablox/admin-sdk';
import { computed } from 'vue';
import { currentPrimary, type DomainForm } from '../model/site-domains';
import { site as actions, type SiteDomain } from '../queries';

/** Adds or edits a host name of the site. */
const props = defineProps<{
  /** The domain being edited, or null to add one. */
  domain: SiteDomain | null;
  /** Every domain of the space, for the primary hint. */
  domains: readonly SiteDomain[];
  spaceId: string;
}>();
const emit = defineEmits<{ close: [] }>();

const spaces = useSpaceStore();
/** A new domain goes into the open environment unless another is picked. */
const environment = useEnvironmentChoice();

const form = useDraftForm<DomainForm>();
form.load({
  hostname: props.domain?.hostname ?? '',
  locale: props.domain?.locale ?? null,
  isPrimary: props.domain?.isPrimary ?? false,
  redirectToPrimary: props.domain?.redirectToPrimary ?? false,
});
const draft = form.draft;
const errorFor = form.fieldError;
const otherErrors = computed(() => form.otherErrors([['hostname'], ['locale']]));

const localeOptions = computed(() => [
  { value: null, label: 'Every language', hint: 'Languages by path prefix, like /de/about' },
  ...(spaces.current?.locales ?? []).map((code) => ({
    value: code,
    label: localeName(code),
    hint: `Only ${code}, without a prefix`,
  })),
]);

const normalised = computed(() => (draft.value ? previewHostname(draft.value.hostname) : null));
const hostnameHint = computed(() => {
  const typed = draft.value?.hostname.trim() ?? '';
  if (!typed) return 'Just the name, like www.example.com. No https:// or path needed.';
  if (!normalised.value) return 'That is not a host name yet.';
  return normalised.value === typed ? 'Looks good.' : `Saved as ${normalised.value}`;
});

const primary = computed(() =>
  draft.value ? currentPrimary(props.domains, draft.value.locale, props.domain?.id ?? null) : null,
);

function save() {
  const current = draft.value;
  if (!current) return false;
  return form.submit(async () => {
    const input = {
      hostname: current.hostname,
      locale: current.locale,
      isPrimary: current.isPrimary,
      redirectToPrimary: current.isPrimary ? false : current.redirectToPrimary,
    };
    const target = environment.target.value;
    const elsewhere = !props.domain && target !== environment.machineName.value;
    const saved = props.domain
      ? await actions.updateDomain(props.spaceId, props.domain.id, input)
      : await actions.createDomain(props.spaceId, { ...input, environment: target });
    toast.success(
      elsewhere
        ? `Saved ${saved.hostname} in ${environment.nameOf(target)} - open that environment to see it`
        : `Saved ${saved.hostname}`,
    );
  });
}
</script>

<template>
  <FormDialog
    :title="domain ? `Edit ${domain.hostname}` : 'Add a domain'"
    form-class="ws:space-y-5"
    :busy="form.saving.value"
    :disabled="!draft?.hostname.trim()"
    @submit="save"
    @close="emit('close')"
  >
    <template v-if="draft">
      <TextField
        v-model="draft.hostname"
        label="Host name"
        class="mb-input-mono"
        placeholder="www.example.com"
        autocomplete="off"
        spellcheck="false"
        :hint="hostnameHint"
        :error="errorFor(['hostname'])"
      />

      <FormField v-if="!domain && environment.choosable.value" v-slot="{ id }" label="Environment" hint="The environment the domain serves; each has its own domains.">
        <Select :id="id" v-model="environment.target.value" :options="environment.options.value" />
      </FormField>

      <FormField label="Language" :error="errorFor(['locale'])" v-slot="{ id }">
        <Select :id="id" v-model="draft.locale" :options="localeOptions" />
      </FormField>

      <div class="ws:space-y-2">
        <Checkbox v-model="draft.isPrimary" align="start">
          <span class="ws:min-w-0">
            Primary domain
            <span class="ws:block mb-meta">
              Links, the sitemap and canonical addresses use it.
              <template v-if="primary && draft.isPrimary">It takes over from {{ primary.hostname }}.</template>
              <template v-else-if="!primary && !domain">The first domain of a language is its primary anyway.</template>
            </span>
          </span>
        </Checkbox>
        <Checkbox v-if="!draft.isPrimary" v-model="draft.redirectToPrimary" align="start">
          <span class="ws:min-w-0">
            Redirect to the primary domain
            <span class="ws:block mb-meta">
              Visitors on this name are sent on with a 301<template v-if="primary"> to {{ primary.hostname }}</template>,
              like example.com to www.example.com.
            </span>
          </span>
        </Checkbox>
      </div>

      <div v-if="otherErrors.length" class="mb-callout ws:text-xs" role="alert">
        <p v-for="message in otherErrors" :key="message">{{ message }}</p>
      </div>
    </template>
  </FormDialog>
</template>
