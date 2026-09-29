<script setup lang="ts">
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { AuthError, auth } from '@manablox/admin-sdk/lib/auth';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';
import { totpQrSvg, totpSecret } from '../two-factor';
import BackupCodes from './BackupCodes.vue';

/** Sets up two-factor: password, then a scanned key and its first code, then the backup codes. */
const emit = defineEmits<{ enrolled: []; done: [] }>();

type Step = 'password' | 'scan' | 'codes';
const step = ref<Step>('password');
const password = ref('');
const code = ref('');
const uri = ref('');
const backupCodes = ref<string[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);

const qr = computed(() => (uri.value ? totpQrSvg(uri.value) : ''));
const secret = computed(() => totpSecret(uri.value));

function describe(err: unknown): string {
  if (err instanceof AuthError) {
    if (err.code === 'INVALID_PASSWORD') return 'That password is not right.';
    if (err.code === 'INVALID_CODE') return 'That code is not right. Try the current one.';
    if (err.code === 'FEATURE_OFF') return messageFor(new Error('control.feature'));
  }
  return err instanceof Error ? messageFor(err) : 'Two-factor authentication could not be set up';
}

async function start() {
  await runWrite(
    async () => {
      const result = await auth.enableTwoFactor(password.value);
      uri.value = result.totpURI;
      backupCodes.value = result.backupCodes;
      password.value = '';
      step.value = 'scan';
    },
    { error, busy, describe },
  );
}

async function confirm() {
  const done = await runWrite(() => auth.confirmTwoFactor(code.value.replace(/\s+/g, '')), {
    error,
    busy,
    describe,
  });
  if (!done) return;
  step.value = 'codes';
  emit('enrolled');
}
</script>

<template>
  <div>
    <form v-if="step === 'password'" class="space-y-3" @submit.prevent="start">
      <p class="text-sm text-surface-500">
        You need an authenticator app on your phone, such as 1Password, Google Authenticator or
        Microsoft Authenticator. Confirm your password to begin.
      </p>
      <TextField v-model="password" label="Password" type="password" required autocomplete="current-password" />
      <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
      <div class="flex justify-end">
        <button type="submit" class="mb-btn-primary" :disabled="busy || !password">
          {{ busy ? 'Please wait...' : 'Continue' }}
        </button>
      </div>
    </form>

    <form v-else-if="step === 'scan'" class="space-y-3" @submit.prevent="confirm">
      <p class="text-sm text-surface-500">
        Scan this code with your authenticator app, then enter the 6-digit code it shows.
      </p>
      <div class="flex flex-wrap items-center gap-4">
        <div class="h-40 w-40 shrink-0 overflow-hidden rounded-card bg-white p-1" data-testid="totp-qr" role="img" aria-label="QR code for your authenticator app" v-html="qr" />
        <div class="min-w-0 text-sm">
          <p class="text-surface-500">Cannot scan it? Enter this key instead:</p>
          <p class="mt-1 font-mono break-all select-all" data-testid="totp-secret">{{ secret }}</p>
        </div>
      </div>
      <TextField v-model="code" label="Code from your app" required autocomplete="one-time-code" inputmode="numeric" />
      <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
      <div class="flex justify-end">
        <button type="submit" class="mb-btn-primary" :disabled="busy || !code.trim()">
          {{ busy ? 'Checking...' : 'Turn on' }}
        </button>
      </div>
    </form>

    <div v-else class="space-y-3">
      <p class="text-sm font-semibold">Two-factor authentication is on.</p>
      <BackupCodes :codes="backupCodes" />
      <div class="flex justify-end">
        <button type="button" class="mb-btn-primary" @click="emit('done')">I saved my codes</button>
      </div>
    </div>
  </div>
</template>
