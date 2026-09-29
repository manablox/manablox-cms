<script setup lang="ts">
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import RadioCard from '@manablox/admin-sdk/components/ui/RadioCard.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref, watch } from 'vue';
import {
  instanceSettings,
  TWO_FACTOR_POLICIES,
  type TwoFactorPolicy,
  useInstanceSettings,
} from '../queries';
import SsoSettings from './SsoSettings.vue';

/** Settings -> Security: who must use two-factor authentication, and SSO; superadmin only. */
const session = useSessionStore();
const { data: settings } = useInstanceSettings();

const feature = computed(() => session.feature('twoFactor', null));
const ssoHidden = computed(() => session.feature('sso', null).hidden);
const policy = ref<TwoFactorPolicy>('off');
const saving = ref(false);
const error = ref<string | null>(null);

watch(
  () => settings.value?.twoFactor.policy,
  (stored) => {
    if (stored) policy.value = stored;
  },
  { immediate: true },
);

const dirty = computed(() => settings.value?.twoFactor.policy !== policy.value);

async function save() {
  const done = await runWrite(() => instanceSettings.setTwoFactorPolicy(policy.value), {
    error,
    busy: saving,
    success: 'Two-factor policy saved',
  });
  // The policy may now cover the admin too.
  if (done) await session.refresh();
}
</script>

<template>
  <Panel
    title="Security"
    description="Sign-in rules for every account on this instance."
    size="lg"
    :card="false"
  >
    <form v-if="!feature.hidden" class="mb-card space-y-3" @submit.prevent="save">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="text-sm font-bold">Two-factor authentication</h3>
          <p class="mb-meta">
            Who must enter a code from an authenticator app at sign-in. Accounts it covers set it up
            right after their next sign-in, before they can do anything else.
          </p>
        </div>
        <FeatureLock v-if="!feature.enabled" feature="twoFactor" instance />
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        <RadioCard
          v-for="entry in TWO_FACTOR_POLICIES"
          :key="entry.value"
          v-model="policy"
          name="two-factor-policy"
          :value="entry.value"
          :title="entry.title"
          :hint="entry.hint"
          :disabled="!feature.enabled && entry.value !== 'off'"
        />
      </div>
      <p v-if="!feature.enabled && settings?.twoFactor.policy !== 'off'" class="mb-hint">
        Two-factor authentication is not available at the moment, so nobody is asked for it.
      </p>
      <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
      <div class="flex justify-end">
        <SaveButton type="submit" :saving="saving" :disabled="!dirty" />
      </div>
    </form>
    <SsoSettings />
    <p v-if="feature.hidden && ssoHidden" class="mb-hint">
      No security settings are available on this instance.
    </p>
  </Panel>
</template>
