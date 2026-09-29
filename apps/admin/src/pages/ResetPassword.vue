<script setup lang="ts">
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { AuthError, auth } from '@manablox/admin-sdk/lib/auth';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';

/** Sets a password from a one-time link (`?token=`), for a reset or a new account. */
const route = useRoute();
const session = useSessionStore();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const password = ref('');
const again = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const done = ref(false);
/** Set once the server refuses the link. */
const expired = ref(false);

const mismatch = computed(() => again.value.length > 0 && password.value !== again.value);

function describe(err: unknown): string {
  if (err instanceof AuthError) {
    if (err.code === 'INVALID_TOKEN') {
      expired.value = true;
      return 'This link was already used or has expired.';
    }
    if (err.code === 'PASSWORD_TOO_SHORT') return 'The password needs at least 12 characters.';
    if (err.code === 'PASSWORD_TOO_LONG') return 'That password is too long.';
  }
  return err instanceof Error ? messageFor(err) : 'The password could not be set';
}

async function submit() {
  if (mismatch.value) return;
  done.value = await runWrite(() => auth.resetPassword(token.value, password.value), {
    error,
    busy,
    describe,
  });
  // The reset ends every session, this browser's included.
  if (done.value && session.isAuthenticated) await session.refresh();
}
</script>

<template>
  <AuthLayout>
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">A fresh start,</span><br />
        one password away.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        Pick something long that you do not use anywhere else. A password manager helps.
      </p>
    </template>

    <p class="mb-eyebrow">Your password</p>
    <h2 class="mb-title mt-1">Choose a password</h2>

    <div v-if="done" class="mt-4 space-y-4 text-sm text-surface-500" role="status">
      <p>Your password is set. Sign in with it now; every other device was signed out.</p>
      <RouterLink :to="{ name: 'login' }" class="mb-btn-primary mb-btn-lg w-full">Sign in</RouterLink>
    </div>

    <div v-else-if="!token || expired" class="mt-4 space-y-4 text-sm text-surface-500" role="alert">
      <p>{{ token ? 'This link was already used or has expired.' : 'This link is not complete.' }}</p>
      <p>
        <RouterLink :to="{ name: 'forgot-password' }" class="mb-link">Ask for a new link</RouterLink>,
        or ask an administrator of your installation to set a password for you.
      </p>
    </div>

    <template v-else>
      <p class="mt-2 text-sm text-surface-500">At least 12 characters. The link works once.</p>

      <form class="mt-8 space-y-4" @submit.prevent="submit">
        <TextField v-model="password" label="New password" type="password" required minlength="12" autocomplete="new-password" />
        <TextField
          v-model="again"
          label="New password, again"
          type="password"
          required
          autocomplete="new-password"
          :error="mismatch ? 'The two do not match.' : ''"
        />

        <p v-if="error" class="mb-error" role="alert">{{ error }}</p>

        <button type="submit" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy || mismatch">
          {{ busy ? 'Please wait...' : 'Set password' }}
        </button>
      </form>
    </template>

    <p v-if="!done" class="mt-6 text-sm">
      <RouterLink :to="{ name: 'login' }" class="mb-link">Back to sign-in</RouterLink>
    </p>
  </AuthLayout>
</template>
