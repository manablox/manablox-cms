<script setup lang="ts">
import FeatureLock from '@manablox/admin-sdk/components/feature/FeatureLock.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { AuthError, auth } from '@manablox/admin-sdk/lib/auth';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref } from 'vue';
import BackupCodes from './BackupCodes.vue';
import TwoFactorEnrol from './TwoFactorEnrol.vue';

/** Profile -> Security: turns two-factor on or off and renews the backup codes. */
const session = useSessionStore();

const state = computed(() => session.me?.twoFactor ?? null);
const feature = computed(() => session.feature('twoFactor', null));
const enrolling = ref(false);
/** The password prompt that is open. */
const prompt = ref<'codes' | 'disable' | null>(null);
const password = ref('');
const error = ref<string | null>(null);
const codes = ref<string[] | null>(null);

function describe(err: unknown): string {
  if (err instanceof AuthError && err.code === 'INVALID_PASSWORD') {
    return 'That password is not right.';
  }
  return err instanceof Error ? messageFor(err) : 'That did not work';
}

function open(kind: 'codes' | 'disable') {
  prompt.value = kind;
  password.value = '';
  error.value = null;
}

async function submit() {
  if (prompt.value === 'codes') {
    return runWrite(
      async () => {
        codes.value = (await auth.generateBackupCodes(password.value)).backupCodes;
      },
      { error, describe },
    );
  }
  const done = await runWrite(() => auth.disableTwoFactor(password.value), {
    error,
    describe,
    success: 'Two-factor authentication is off',
  });
  if (done) await session.refresh();
  return done;
}

async function enrolled() {
  await session.refresh();
}
</script>

<template>
  <section v-if="state && !(feature.hidden && !state.enabled)" class="mb-card" data-testid="two-factor-section">
    <div class="mb-4 flex items-center gap-3">
      <span class="mb-tile-sand flex h-10 w-10 shrink-0 items-center justify-center rounded-card">
        <Icon name="smartphone" class="mb-icon-lg" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="flex items-center gap-2 text-sm font-bold">
          Two-factor authentication
          <span v-if="state.enabled" class="mb-badge-ok">On</span>
          <span v-else class="mb-badge">Off</span>
        </h2>
        <p class="mb-meta">
          A code from an app on your phone at every sign-in, so a password alone is not enough.
        </p>
      </div>
    </div>

    <template v-if="state.enabled">
      <p v-if="state.required" class="mb-hint mb-3">
        Two-factor authentication is required for your account on this instance.
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <button type="button" class="mb-btn-outline" @click="open('codes')">New backup codes</button>
        <button v-if="!state.required" type="button" class="mb-btn-ghost-danger" @click="open('disable')">
          Turn off
        </button>
      </div>
    </template>

    <FeatureLock v-else-if="!feature.enabled" feature="twoFactor" label="Set up" instance trigger-class="mb-btn-outline" />

    <TwoFactorEnrol v-else-if="enrolling" @enrolled="enrolled" @done="enrolling = false" />

    <div v-else class="flex justify-end">
      <button type="button" class="mb-btn-primary" @click="enrolling = true">Set up</button>
    </div>

    <FormDialog
      v-if="prompt && !codes"
      :title="prompt === 'codes' ? 'New backup codes' : 'Turn off two-factor authentication'"
      :submit-label="prompt === 'codes' ? 'Create codes' : 'Turn off'"
      busy-label="Please wait..."
      :danger="prompt === 'disable'"
      :disabled="!password"
      form-class="space-y-3"
      :on-submit="submit"
      @close="prompt = null"
    >
      <p class="text-sm text-surface-500">
        {{ prompt === 'codes'
          ? 'Your old backup codes stop working. Confirm your password to continue.'
          : 'Signing in then needs only your password. Confirm it to continue.' }}
      </p>
      <TextField v-model="password" label="Password" type="password" required autocomplete="current-password" />
      <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
    </FormDialog>

    <FormDialog
      v-if="codes"
      title="Your new backup codes"
      submit-label="I saved my codes"
      :on-submit="() => true"
      @close="codes = null; prompt = null"
    >
      <BackupCodes :codes="codes" />
    </FormDialog>
  </section>
</template>
