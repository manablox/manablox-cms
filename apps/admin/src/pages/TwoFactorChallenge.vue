<script setup lang="ts">
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { AuthError, auth } from '@manablox/admin-sdk/lib/auth';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';

/** The second sign-in step: a code from the authenticator app, or a backup code. */
const session = useSessionStore();
const router = useRouter();
const route = useRoute();

const useBackup = ref(false);
const code = ref('');
const trustDevice = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
/** Set once the pending sign-in is gone; only signing in again helps. */
const expired = ref(false);

const label = computed(() => (useBackup.value ? 'Backup code' : 'Code from your app'));

function describe(err: unknown): string {
  if (err instanceof AuthError) {
    if (err.code === 'INVALID_CODE') return 'That code is not right. Try the current one.';
    if (err.code === 'INVALID_BACKUP_CODE') return 'That backup code is not right or was used.';
    if (err.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
      return 'Too many wrong codes. Wait a few minutes and sign in again.';
    }
    if (
      err.code === 'INVALID_TWO_FACTOR_COOKIE' ||
      err.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'
    ) {
      expired.value = true;
      return 'This sign-in has expired. Sign in again.';
    }
  }
  return err instanceof Error ? messageFor(err) : 'The code could not be checked';
}

function toggle() {
  useBackup.value = !useBackup.value;
  code.value = '';
  error.value = null;
}

async function submit() {
  const entered = code.value.trim();
  const done = await runWrite(
    () =>
      useBackup.value
        ? auth.verifyBackupCode(entered)
        : auth.verifyTotp(entered.replace(/\s+/g, ''), trustDevice.value),
    { error, busy, describe },
  );
  if (!done) return;
  await session.refresh();
  await router.replace((route.query.redirect as string) ?? '/');
}
</script>

<template>
  <AuthLayout>
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">One more step,</span><br />
        then you are in.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        Two-factor authentication keeps your account safe even if someone learns your password.
      </p>
    </template>

    <p class="mb-eyebrow">Two-factor authentication</p>
    <h2 class="mb-title mt-1">Enter your code</h2>

    <div v-if="expired" class="mt-4 space-y-4 text-sm text-surface-500" role="alert">
      <p>This sign-in has expired. Sign in again to get a new chance.</p>
      <RouterLink :to="{ name: 'login', query: route.query }" class="mb-btn-primary mb-btn-lg w-full">Sign in again</RouterLink>
    </div>

    <template v-else>
      <p class="mt-2 text-sm text-surface-500">
        {{ useBackup
          ? 'Use one of the backup codes you saved when you set up two-factor authentication. Each works once.'
          : 'Open your authenticator app and enter the 6-digit code it shows for Manablox.' }}
      </p>

      <form class="mt-8 space-y-4" @submit.prevent="submit">
        <TextField
          v-model="code"
          :label="label"
          required
          autocomplete="one-time-code"
          :inputmode="useBackup ? 'text' : 'numeric'"
          autofocus
        />
        <Checkbox v-if="!useBackup" v-model="trustDevice">Trust this device for 30 days</Checkbox>

        <p v-if="error" class="mb-error" role="alert">{{ error }}</p>

        <button type="submit" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy || !code.trim()">
          {{ busy ? 'Checking...' : 'Continue' }}
        </button>
      </form>

      <p class="mt-6 text-sm text-surface-500">
        <button type="button" class="mb-link" @click="toggle">
          {{ useBackup ? 'Use a code from your app instead' : 'Lost your device? Use a backup code' }}
        </button>
      </p>
    </template>
  </AuthLayout>
</template>
