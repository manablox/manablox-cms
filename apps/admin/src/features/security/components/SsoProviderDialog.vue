<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import CopyField from '@manablox/admin-sdk/components/ui/CopyField.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import JsonBlock from '@manablox/admin-sdk/components/ui/JsonBlock.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import StringList from '@manablox/admin-sdk/components/ui/StringList.vue';
import Switch from '@manablox/admin-sdk/components/ui/Switch.vue';
import TextareaField from '@manablox/admin-sdk/components/ui/TextareaField.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { errorDetails } from '@manablox/admin-sdk/lib/api-errors';
import { messageFor, messageForKey } from '@manablox/admin-sdk/lib/messages';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import RoleSelect from '~/components/RoleSelect.vue';
import { type SsoProvider, type SsoTestResult, ssoProviders, ssoUrls } from '../queries';

/** Adds an SSO provider, or edits `provider`; its id and protocol are fixed once saved. */
const props = defineProps<{ provider?: SsoProvider | undefined; authBaseUrl: string }>();
const emit = defineEmits<{ close: [] }>();

type Protocol = 'oidc' | 'saml';
const PROTOCOLS = [
  { value: 'oidc' as const, label: 'OpenID Connect' },
  { value: 'saml' as const, label: 'SAML 2.0' },
];

const spaces = useSpaceStore();
const current = props.provider;
const protocol = ref<Protocol>(current?.protocol ?? 'oidc');
const name = ref(current?.name ?? '');
const providerId = ref(current?.providerId ?? '');
const domains = ref<string[]>([...(current?.domains ?? [])]);
const requireSso = ref(current?.requireSso ?? false);
const showOnSignIn = ref(current?.showOnSignIn ?? false);
const createAccounts = ref(current?.createAccounts ?? true);
/** Space id -> role for accounts it creates. */
const grants = ref<Record<string, string>>(
  Object.fromEntries((current?.defaultGrants ?? []).map((grant) => [grant.spaceId, grant.role])),
);
const oidc = ref({
  issuer: current?.oidc?.issuer ?? '',
  clientId: current?.oidc?.clientId ?? '',
  clientSecret: '',
  discoveryEndpoint: current?.oidc?.discoveryEndpoint ?? '',
  scopes: [...(current?.oidc?.scopes ?? [])],
});
const saml = ref({
  entryPoint: current?.saml?.entryPoint ?? '',
  certificate: current?.saml?.certificate ?? '',
  idpEntityId: current?.saml?.idpEntityId ?? '',
  spEntityId: current?.saml?.spEntityId ?? '',
  emailAttribute: current?.saml?.emailAttribute ?? '',
  nameAttribute: current?.saml?.nameAttribute ?? '',
  signRequests: current?.saml?.signRequests ?? false,
  encryptAssertions: current?.saml?.encryptAssertions ?? false,
  idpInitiated: current?.saml?.idpInitiated ?? false,
  landingPath: current?.saml?.landingPath ?? '/',
});
/** The SP certificate; replaced when the keys are regenerated. */
const spCertificate = ref(current?.saml?.spCertificate ?? null);
const spCertificateExpiresAt = ref(current?.saml?.spCertificateExpiresAt ?? null);
const regenerating = ref(false);

const error = ref<string | null>(null);
/** Messages by field path, e.g. `oidc.issuer`. */
const fieldErrors = ref<Record<string, string>>({});
const testing = ref(false);
const tested = ref<SsoTestResult | null>(null);

const urls = computed(() => ssoUrls(props.authBaseUrl, providerId.value.trim()));
const copyable = computed(() =>
  protocol.value === 'oidc'
    ? [{ label: 'Redirect URI', value: urls.value.callback }]
    : [
        { label: 'ACS URL', value: urls.value.acs },
        { label: 'Metadata URL', value: urls.value.metadata },
        { label: 'SP entity id', value: saml.value.spEntityId.trim() || urls.value.metadata },
      ],
);

function toggle(spaceId: string) {
  const next = { ...grants.value };
  if (next[spaceId]) delete next[spaceId];
  else next[spaceId] = 'editor';
  grants.value = next;
}

function input() {
  const common = {
    name: name.value.trim(),
    domains: domains.value,
    requireSso: requireSso.value,
    showOnSignIn: showOnSignIn.value,
    createAccounts: createAccounts.value,
    defaultGrants: Object.entries(grants.value).map(([spaceId, role]) => ({ spaceId, role })),
  };
  if (protocol.value === 'oidc') {
    const { clientSecret, discoveryEndpoint, ...rest } = oidc.value;
    return {
      ...common,
      oidc: {
        ...rest,
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        ...(discoveryEndpoint.trim() ? { discoveryEndpoint: discoveryEndpoint.trim() } : {}),
      },
    };
  }
  return { ...common, saml: saml.value };
}

function describe(err: unknown): string {
  const errors: Record<string, string> = {};
  for (const detail of errorDetails(err)) {
    const path = (detail.path ?? []).join('.');
    if (path) errors[path] ??= messageForKey(detail.key, detail.params);
  }
  fieldErrors.value = errors;
  const message = messageFor(err);
  error.value = Object.keys(errors).length ? null : message;
  return message;
}

const at = (path: string) => fieldErrors.value[path] ?? null;

async function test() {
  testing.value = true;
  tested.value = null;
  try {
    tested.value = await ssoProviders.test(
      protocol.value === 'oidc'
        ? {
            oidc: {
              issuer: oidc.value.issuer.trim(),
              ...(oidc.value.discoveryEndpoint.trim()
                ? { discoveryEndpoint: oidc.value.discoveryEndpoint.trim() }
                : {}),
            },
          }
        : { saml: { certificate: saml.value.certificate } },
    );
  } catch (err) {
    tested.value = { ok: false, message: messageFor(err) };
  } finally {
    testing.value = false;
  }
}

function regenerateKeys() {
  if (!current) return;
  return confirmAndRun(
    {
      title: 'Regenerate SP keys?',
      message:
        'The old key stops working at once: give the identity provider the new certificate or metadata right after, or sign-ins fail.',
      confirmLabel: 'Regenerate',
      danger: true,
    },
    async () => {
      const updated = await ssoProviders.regenerateKeys(current.id);
      spCertificate.value = updated.saml?.spCertificate ?? null;
      spCertificateExpiresAt.value = updated.saml?.spCertificateExpiresAt ?? null;
    },
    { busy: regenerating, success: 'New SP keys generated' },
  );
}

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  return runWrite(
    () =>
      current
        ? ssoProviders.update({ id: current.id, ...input() })
        : ssoProviders.create({ providerId: providerId.value.trim(), ...input() }),
    { describe, success: current ? 'Provider saved' : 'Provider added' },
  );
}
</script>

<template>
  <FormDialog
    :title="current ? `Edit ${current.name}` : 'Add a single sign-on provider'"
    width="max-w-2xl"
    :submit-label="current ? 'Save' : 'Add provider'"
    :disabled="!domains.length || (!current && !providerId.trim())"
    form-class="space-y-4"
    :on-submit="submit"
    @close="emit('close')"
  >
    <SegmentedControl v-if="!current" v-model="protocol" :options="PROTOCOLS" aria-label="Protocol" />

    <div class="grid gap-3 sm:grid-cols-2">
      <TextField v-model="name" label="Name" hint="Shown on the sign-in button." :error="at('name')" />
      <TextField
        v-model="providerId"
        label="Provider id"
        :readonly="Boolean(current)"
        class="font-mono"
        hint="Part of the URLs below; fixed once added."
        :error="at('providerId')"
      />
    </div>

    <FormField label="Email domains" hint="Addresses at these domains, and their subdomains, sign in with this provider." :error="at('domains') ?? at('domains.0')">
      <StringList v-model="domains" :read-only="false" label="Email domain" placeholder="example.com - press Enter" />
    </FormField>

    <template v-if="protocol === 'oidc'">
      <TextField v-model="oidc.issuer" label="Issuer URL" placeholder="https://login.example.com" :error="at('oidc.issuer')" />
      <div class="grid gap-3 sm:grid-cols-2">
        <TextField v-model="oidc.clientId" label="Client id" :error="at('oidc.clientId')" />
        <TextField
          v-model="oidc.clientSecret"
          label="Client secret"
          type="password"
          autocomplete="off"
          :placeholder="current?.oidc?.clientSecretHint ? `Stored, ends in ${current.oidc.clientSecretHint}` : ''"
          :hint="current ? 'Stored encrypted. Leave empty to keep it.' : 'Stored encrypted.'"
          :error="at('oidc.clientSecret')"
        />
      </div>
      <TextField
        v-model="oidc.discoveryEndpoint"
        label="Discovery URL"
        hint="Optional; the issuer's /.well-known/openid-configuration by default."
        :error="at('oidc.discoveryEndpoint')"
      />
      <FormField label="Scopes" hint="openid, email and profile when empty.">
        <StringList v-model="oidc.scopes" :read-only="false" label="Scope" placeholder="openid - press Enter" />
      </FormField>
    </template>

    <template v-else>
      <TextField v-model="saml.entryPoint" label="IdP sign-in URL" placeholder="https://idp.example.com/sso/saml" :error="at('saml.entryPoint')" />
      <TextField v-model="saml.idpEntityId" label="IdP entity id" :error="at('saml.idpEntityId')" />
      <TextareaField
        v-model="saml.certificate"
        label="IdP signing certificate"
        rows="5"
        class="font-mono text-xs"
        placeholder="-----BEGIN CERTIFICATE-----"
        :error="at('saml.certificate')"
      />
      <TextField v-model="saml.spEntityId" label="SP entity id" hint="Optional; the metadata URL by default." />
      <div class="grid gap-3 sm:grid-cols-2">
        <TextField v-model="saml.emailAttribute" label="Email attribute" hint="Optional; email, or the NameID." />
        <TextField v-model="saml.nameAttribute" label="Name attribute" hint="Optional; displayName by default." />
      </div>
      <div class="space-y-2">
        <Switch v-model="saml.signRequests">
          Sign authentication requests
          <span class="block mb-meta">With the SP key; for identity providers that require signed requests.</span>
        </Switch>
        <Switch v-model="saml.encryptAssertions">
          Require encrypted assertions
          <span class="block mb-meta">The metadata offers the SP certificate for encryption; unencrypted assertions are refused.</span>
        </Switch>
        <Switch v-model="saml.idpInitiated">
          Accept IdP-initiated sign-in
          <span class="block mb-meta">Sign-ins started from the identity provider's portal, without the Manablox sign-in page.</span>
        </Switch>
      </div>
      <TextField
        v-if="saml.idpInitiated"
        v-model="saml.landingPath"
        label="Landing page"
        placeholder="/"
        class="font-mono"
        hint="Admin path people land on after an IdP-initiated sign-in."
        :error="at('saml.landingPath')"
      />
    </template>

    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="mb-btn-outline mb-btn-sm" :disabled="testing" @click="test">
        <Icon name="activity" class="mb-icon-sm" />
        {{ testing ? 'Testing...' : protocol === 'oidc' ? 'Test connection' : 'Check certificate' }}
      </button>
      <p v-if="tested?.ok && tested.protocol === 'oidc'" class="text-xs text-ok-700 dark:text-ok-300" data-testid="sso-test">
        Found the provider; it signs in at {{ tested.authorizationEndpoint }}.
      </p>
      <p v-else-if="tested?.ok && tested.protocol === 'saml'" class="text-xs text-ok-700 dark:text-ok-300" data-testid="sso-test">
        {{ tested.subject }}, valid until {{ new Date(tested.expiresAt).toLocaleDateString() }}.
      </p>
      <p v-else-if="tested && !tested.ok" class="mb-error text-xs" data-testid="sso-test">{{ tested.message }}</p>
    </div>

    <FormField label="Give these to the identity provider">
      <ul class="mb-list-divided text-sm">
        <li v-for="entry in copyable" :key="entry.label" class="py-1.5">
          <CopyField :value="entry.value" :label="entry.label" url inline />
        </li>
      </ul>
    </FormField>

    <FormField v-if="protocol === 'saml'" label="SP certificate" hint="Signs requests and decrypts assertions; the metadata URL publishes it.">
      <div v-if="spCertificate" class="space-y-2" data-testid="sp-certificate">
        <JsonBlock :value="spCertificate" label="SP certificate" max-height="max-h-32" />
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="mb-btn-outline mb-btn-sm" :disabled="regenerating" @click="regenerateKeys">
            <Icon name="key" class="mb-icon-sm" />
            {{ regenerating ? 'Regenerating...' : 'Regenerate SP keys' }}
          </button>
          <span v-if="spCertificateExpiresAt" class="mb-meta">
            Valid until {{ new Date(spCertificateExpiresAt).toLocaleDateString() }}.
          </span>
        </div>
      </div>
      <p v-else class="mb-meta">A key pair is generated when the provider is saved.</p>
    </FormField>

    <div class="space-y-2">
      <Switch v-model="requireSso">
        Require single sign-on for these domains
        <span class="block mb-meta">Password sign-in and password resets are refused for them; signed-in sessions stay.</span>
      </Switch>
      <Switch v-model="showOnSignIn">List it as a button on the sign-in page</Switch>
      <Switch v-model="createAccounts">
        Create an account at the first sign-in
        <span class="block mb-meta">Otherwise only people with an account can sign in with it.</span>
      </Switch>
    </div>

    <FormField v-if="createAccounts" label="New accounts join" hint="Spaces and roles of accounts it creates." :error="at('defaultGrants')">
      <ul class="mb-list-divided text-sm">
        <li v-for="space in spaces.spaces" :key="space.id" class="flex items-center gap-2 py-2">
          <Checkbox class="min-w-0 flex-1" :model-value="Boolean(grants[space.id])" @update:model-value="toggle(space.id)">
            <span class="truncate">{{ space.name }}</span>
          </Checkbox>
          <RoleSelect
            v-if="grants[space.id]"
            class="w-36 shrink-0"
            :space-id="space.id"
            :model-value="grants[space.id] as string"
            variant="sm"
            @update:model-value="grants = { ...grants, [space.id]: $event }"
          />
        </li>
      </ul>
    </FormField>

    <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
  </FormDialog>
</template>
