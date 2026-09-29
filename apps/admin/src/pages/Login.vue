<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { auth, type SsoProvider } from '@manablox/admin-sdk/lib/auth';
import { hasMessage, messageFor, messageForKey } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';

/** Sign-in only; an instance without accounts goes to the install wizard. */
const session = useSessionStore();
const router = useRouter();
const route = useRoute();

/** How long typing pauses before the address is checked for single sign-on. */
const LOOKUP_DELAY_MS = 350;

const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
/** Shown only when the instance can mail reset links. */
const resetOffered = ref(false);
/** Providers listed as buttons. */
const providers = ref<SsoProvider[]>([]);
/** The provider serving the typed address's domain. */
const detected = ref<(SsoProvider & { required: boolean }) | null>(null);

/** The address must sign in with single sign-on, so there is no password to ask for. */
const ssoOnly = computed(() => detected.value?.required === true);
const buttons = computed(() =>
  providers.value.filter((provider) => provider.providerId !== detected.value?.providerId),
);

onMounted(async () => {
  [resetOffered.value, providers.value] = await Promise.all([
    auth.passwordResetEnabled(),
    auth.ssoProviders(),
  ]);
});

// Back from the identity provider with a refusal.
const refused = route.query.error;
if (typeof refused === 'string' && refused) {
  const key = route.query.error_description;
  error.value =
    typeof key === 'string' && hasMessage(key)
      ? messageForKey(key)
      : `Single sign-on did not complete (${refused}).`;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let asked = 0;

async function lookup(address: string) {
  const ask = ++asked;
  const found = address.includes('@') ? await auth.ssoLookup(address) : null;
  if (ask === asked) detected.value = found;
  return found;
}

watch(email, (address) => {
  clearTimeout(timer);
  timer = setTimeout(() => void lookup(address.trim()), LOOKUP_DELAY_MS);
});
onBeforeUnmount(() => clearTimeout(timer));

/** Leaves for the identity provider; it sends the browser back signed in or with an error. */
async function continueWith(provider: SsoProvider) {
  const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  const origin = window.location.origin;
  await runWrite(
    async () => {
      const { url } = await auth.signInSso(
        provider.providerId,
        `${origin}${target}`,
        `${origin}${router.resolve({ name: 'login', query: route.query.redirect ? { redirect: target } : {} }).href}`,
      );
      window.location.assign(url);
    },
    {
      error,
      busy,
      describe: (err) => (err instanceof Error ? messageFor(err) : 'Sign-in failed'),
    },
  );
}

async function submit() {
  clearTimeout(timer);
  const provider = detected.value ?? (await lookup(email.value.trim()));
  if (provider?.required) return continueWith(provider);
  const outcome = { step: 'signedIn' as 'signedIn' | 'twoFactor' };
  const done = await runWrite(
    async () => {
      outcome.step = await session.signIn(email.value, password.value);
    },
    {
      error,
      busy,
      describe: (err) => (err instanceof Error ? messageFor(err) : 'Sign-in failed'),
    },
  );
  if (!done) return;
  if (outcome.step === 'twoFactor') {
    await router.replace({ name: 'two-factor', query: { ...route.query } });
    return;
  }
  await router.replace((route.query.redirect as string) ?? '/');
}
</script>

<template>
  <AuthLayout>
    <template #panel>
      <!-- Two whites for emphasis: the accent purple is unreadable on this panel. -->
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">Blocks of content,</span><br />
        delivered anywhere.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        Structured content types, a tree of documents, translations, media and a
        delivery API - in one self-hosted box.
      </p>
      <ul class="mt-8 space-y-2 text-sm text-brand-50">
        <li class="flex items-center gap-2.5"><Icon name="blocks" class="mb-icon text-white" /> Types in code or in the admin</li>
        <li class="flex items-center gap-2.5"><Icon name="tree" class="mb-icon text-white" /> Documents in a tree, per language</li>
        <li class="flex items-center gap-2.5"><Icon name="template" class="mb-icon text-white" /> Templates, menus and plugins</li>
        <li class="flex items-center gap-2.5"><Icon name="globe" class="mb-icon text-white" /> Delivered over GraphQL and REST</li>
      </ul>
    </template>

    <p class="mb-eyebrow">Welcome back</p>
    <h2 class="mb-title mt-1">Sign in</h2>
    <p class="mt-2 text-sm text-surface-500">
      Use the email and password of your Manablox account.
    </p>

    <form class="mt-8 space-y-4" @submit.prevent="submit">
      <TextField v-model="email" label="Email" type="email" required autocomplete="email" />

      <TextField v-if="!ssoOnly" v-model="password" label="Password" type="password" required autocomplete="current-password">
        <template v-if="resetOffered" #actions>
          <RouterLink :to="{ name: 'forgot-password', query: email ? { email } : {} }" class="text-xs mb-link">Forgot password?</RouterLink>
        </template>
      </TextField>
      <p v-else class="text-sm text-surface-500" data-testid="sso-only">
        Your organisation signs in with {{ detected?.name }}.
      </p>

      <p v-if="error" class="mb-error" role="alert">{{ error }}</p>

      <button type="submit" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy">
        {{ busy ? 'Please wait...' : ssoOnly ? `Continue with ${detected?.name}` : 'Sign in' }}
      </button>
    </form>

    <div v-if="(detected && !ssoOnly) || buttons.length" class="mt-6 space-y-2" data-testid="sso-buttons">
      <p class="mb-eyebrow text-center">Or sign in with</p>
      <button
        v-for="provider in detected && !ssoOnly ? [detected, ...buttons] : buttons"
        :key="provider.providerId"
        type="button"
        class="mb-btn-outline mb-btn-lg w-full"
        :disabled="busy"
        @click="continueWith(provider)"
      >
        <Icon name="key" class="mb-icon" /> Continue with {{ provider.name }}
      </button>
    </div>
  </AuthLayout>
</template>
