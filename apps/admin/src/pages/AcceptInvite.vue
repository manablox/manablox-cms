<script setup lang="ts">
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';
import { type InvitationPreview, invitations } from '~/features/invitations/queries';

/**
 * Accepts an invitation (`?token=`): a new account with a name and password, or the grants for
 * the signed-in account of the invited address.
 */
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const spaces = useSpaceStore();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const preview = ref<InvitationPreview | null>(null);
const loadError = ref<string | null>(null);
const loading = ref(true);

const name = ref('');
const password = ref('');
const again = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const mismatch = computed(() => again.value.length > 0 && password.value !== again.value);
/** Signed in with the invited address. */
const signedInAsInvited = computed(() =>
  Boolean(preview.value && session.me?.email === preview.value.email),
);

onMounted(async () => {
  if (!token.value) {
    loading.value = false;
    return;
  }
  try {
    preview.value = await invitations.preview(token.value);
  } catch (err) {
    loadError.value = messageFor(err);
  } finally {
    loading.value = false;
  }
});

function describe(err: unknown): string {
  return err instanceof Error ? messageFor(err) : 'The invitation could not be accepted';
}

async function createAccount() {
  if (mismatch.value || !preview.value) return;
  const email = preview.value.email;
  const done = await runWrite(
    () => invitations.accept(token.value, { name: name.value.trim(), password: password.value }),
    { error, busy, describe },
  );
  if (!done) return;
  const step = await session.signIn(email, password.value).catch(() => null);
  if (step === 'twoFactor') await router.replace({ name: 'two-factor' });
  else await router.replace(step ? '/' : { name: 'login' });
}

async function join() {
  const done = await runWrite(() => invitations.accept(token.value), {
    error,
    busy,
    describe,
    success: 'Invitation accepted',
  });
  if (!done) return;
  await session.refresh();
  await spaces.load();
  await router.replace('/');
}

async function switchAccount() {
  await session.signOut();
  await router.replace({ name: 'login', query: { redirect: route.fullPath } });
}
</script>

<template>
  <AuthLayout>
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">You are invited,</span><br />
        come on in.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        Manablox keeps content in spaces: a site or channel each, with its own documents,
        languages and assets.
      </p>
    </template>

    <p class="mb-eyebrow">Invitation</p>
    <h2 class="mb-title mt-1">Join Manablox</h2>

    <div v-if="loading" class="mt-6 flex items-center gap-3 text-sm text-surface-500" role="status">
      <Loader /> Opening your invitation...
    </div>

    <div v-else-if="!preview" class="mt-4 space-y-4 text-sm text-surface-500" role="alert">
      <p>{{ token ? loadError : 'This link is not complete.' }}</p>
      <p>Ask the person who invited you to send a new invitation.</p>
    </div>

    <template v-else>
      <p class="mt-2 text-sm text-surface-500" data-testid="invite-summary">
        <template v-if="preview.inviter">{{ preview.inviter }} invited </template>
        <template v-else>You are invited as </template>
        <strong class="text-surface-900 dark:text-surface-50">{{ preview.email }}</strong>
        <template v-if="preview.spaces.length">
          to {{ preview.spaces.map((space) => `${space.name} (${space.role})`).join(', ') }}</template>.
      </p>

      <div v-if="preview.accountExists" class="mt-6 space-y-4 text-sm text-surface-500">
        <template v-if="signedInAsInvited">
          <p>You are signed in with this address. Accept to join.</p>
          <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
          <button type="button" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy" @click="join">
            {{ busy ? 'Please wait...' : 'Accept invitation' }}
          </button>
        </template>
        <template v-else-if="session.isAuthenticated">
          <p>You are signed in as {{ session.me?.email }}. Sign in as {{ preview.email }} to accept.</p>
          <button type="button" class="mb-btn-primary mb-btn-lg w-full" @click="switchAccount">Switch account</button>
        </template>
        <template v-else>
          <p>This address already has an account. Sign in with it to accept.</p>
          <RouterLink :to="{ name: 'login', query: { redirect: route.fullPath } }" class="mb-btn-primary mb-btn-lg w-full">
            Sign in
          </RouterLink>
        </template>
      </div>

      <form v-else class="mt-8 space-y-4" @submit.prevent="createAccount">
        <TextField v-model="name" label="Your name" required autocomplete="name" />
        <TextField v-model="password" label="Password" type="password" required minlength="12" autocomplete="new-password" hint="At least 12 characters." />
        <TextField
          v-model="again"
          label="Password, again"
          type="password"
          required
          autocomplete="new-password"
          :error="mismatch ? 'The two do not match.' : ''"
        />
        <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
        <button type="submit" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy || mismatch">
          {{ busy ? 'Please wait...' : 'Create account and join' }}
        </button>
      </form>
    </template>
  </AuthLayout>
</template>
