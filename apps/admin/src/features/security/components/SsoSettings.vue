<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import { type SsoProvider, ssoProviders, useSsoProviders } from '../queries';
import SsoProviderDialog from './SsoProviderDialog.vue';

/**
 * Settings -> Security: OIDC and SAML providers. While the `sso` feature is off, stored
 * providers are listed read-only and nobody signs in through them.
 */
const session = useSessionStore();
const feature = computed(() => session.feature('sso', null));
const { data, isPending, error, refetch } = useSsoProviders();

/** `null` adds a provider; closed while `undefined`. */
const editing = ref<SsoProvider | null | undefined>(undefined);

function remove(provider: SsoProvider) {
  return confirmAndRun(
    {
      title: `Remove ${provider.name}?`,
      message:
        'Accounts keep their sessions but lose the link to this provider. Accounts it created have no password until they set one.',
      confirmLabel: 'Remove provider',
      danger: true,
    },
    () => ssoProviders.remove(provider.id),
    { success: 'Provider removed' },
  );
}
</script>

<template>
  <section v-if="!feature.hidden" class="mb-card space-y-3" data-testid="sso-settings">
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-bold">Single sign-on</h3>
        <p class="mb-meta">
          Sign in through your organisation's identity provider with OpenID Connect or SAML.
          Single sign-on is not asked for a two-factor code; the identity provider handles that.
        </p>
      </div>
      <FeatureGate feature="sso" instance>
        <button type="button" class="mb-btn-outline mb-btn-sm" @click="editing = null">
          <Icon name="plus" class="mb-icon-sm" /> Add provider
        </button>
      </FeatureGate>
    </div>

    <p v-if="!feature.enabled && data?.providers.length" class="mb-hint">
      Single sign-on is not available at the moment: nobody signs in through these providers,
      and their domains may use passwords again.
    </p>
    <AsyncList :pending="isPending" :items="data?.providers" :error="error" :retry="refetch" :rows="2" empty="bare" empty-title="No providers yet." list-class="text-sm" item-class="flex items-center gap-3 py-2">
      <template #item="{ item: provider }">
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 font-medium">
            {{ provider.name }}
            <span class="mb-badge">{{ provider.protocol === 'oidc' ? 'OpenID Connect' : 'SAML' }}</span>
            <span v-if="provider.requireSso" class="mb-badge-brand">Required</span>
          </p>
          <p class="truncate font-mono mb-meta">{{ provider.domains.join(', ') }}</p>
        </div>
        <template v-if="feature.enabled">
          <button type="button" class="mb-btn-ghost mb-btn-sm" :aria-label="`Edit ${provider.name}`" @click="editing = provider">
            <Icon name="pencil" class="mb-icon-sm" />
          </button>
          <button type="button" class="mb-btn-ghost mb-btn-sm" :aria-label="`Remove ${provider.name}`" @click="remove(provider)">
            <Icon name="trash" class="mb-icon-sm" />
          </button>
        </template>
      </template>
    </AsyncList>

    <SsoProviderDialog
      v-if="editing !== undefined && data"
      :provider="editing ?? undefined"
      :auth-base-url="data.authBaseUrl"
      @close="editing = undefined"
    />
  </section>
</template>
