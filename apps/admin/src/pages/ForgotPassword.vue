<script setup lang="ts">
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { auth } from '@manablox/admin-sdk/lib/auth';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';

/** Asks for a reset link by mail; the answer never says whether the address has an account. */
const route = useRoute();

const email = ref(typeof route.query.email === 'string' ? route.query.email : '');
const error = ref<string | null>(null);
const busy = ref(false);
const sent = ref(false);
/** `null` while asking the server. */
const offered = ref<boolean | null>(null);

onMounted(async () => {
  offered.value = await auth.passwordResetEnabled();
});

async function submit() {
  sent.value = await runWrite(() => auth.requestPasswordReset(email.value.trim()), {
    error,
    busy,
    describe: (err) => (err instanceof Error ? messageFor(err) : 'The link could not be sent'),
  });
}
</script>

<template>
  <AuthLayout>
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">Locked out?</span><br />
        It happens.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        We mail you a link that lets you choose a new password. It works once and expires after
        an hour.
      </p>
    </template>

    <p class="mb-eyebrow">Forgot password</p>
    <h2 class="mb-title mt-1">Reset your password</h2>

    <div v-if="offered === false" class="mt-4 space-y-4 text-sm text-surface-500">
      <p>
        This installation cannot send mail, so it cannot send reset links. Ask an administrator
        of your installation to set a new password for you.
      </p>
    </div>

    <div v-else-if="sent" class="mt-4 space-y-4 text-sm text-surface-500" role="status">
      <p>
        If an account uses <strong class="text-surface-800 dark:text-surface-100">{{ email }}</strong>,
        a link to reset its password is on its way. Check your inbox, and your spam folder too.
      </p>
      <p>The link works once and expires after an hour.</p>
    </div>

    <template v-else>
      <p class="mt-2 text-sm text-surface-500">
        Type the email you sign in with. We send a link to choose a new password.
      </p>

      <form class="mt-8 space-y-4" @submit.prevent="submit">
        <TextField v-model="email" label="Email" type="email" required autocomplete="email" />

        <p v-if="error" class="mb-error" role="alert">{{ error }}</p>

        <button type="submit" class="mb-btn-primary mb-btn-lg w-full" :disabled="busy || offered === null">
          {{ busy ? 'Please wait...' : 'Send reset link' }}
        </button>
      </form>
    </template>

    <p class="mt-6 text-sm">
      <RouterLink :to="{ name: 'login' }" class="mb-link">Back to sign-in</RouterLink>
    </p>
  </AuthLayout>
</template>
