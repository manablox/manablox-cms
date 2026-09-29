<script setup lang="ts">
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import { messageFor } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';
import { profile } from '~/features/users/queries';

/** Redeems an email confirmation link (`?token=`) as soon as it opens. */
const route = useRoute();
const session = useSessionStore();

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const email = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

onMounted(async () => {
  if (!token.value) return;
  await runWrite(
    async () => {
      email.value = (await profile.verifyEmail(token.value)).email;
    },
    { error, busy, describe: (err) => (err instanceof Error ? messageFor(err) : 'Not confirmed') },
  );
  if (email.value && session.isAuthenticated) await session.refresh();
});
</script>

<template>
  <AuthLayout>
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">Almost there,</span><br />
        just confirming.
      </h1>
    </template>

    <p class="mb-eyebrow">Your email address</p>
    <h2 class="mb-title mt-1">Confirm your email</h2>

    <div v-if="busy" class="mt-6 flex items-center gap-3 text-sm text-surface-500" role="status">
      <Loader /> Confirming...
    </div>

    <div v-else-if="email" class="mt-4 space-y-4 text-sm text-surface-500" role="status">
      <p>
        <strong class="text-surface-900 dark:text-surface-50">{{ email }}</strong> is confirmed.
        Sign in with it from now on.
      </p>
      <RouterLink :to="session.isAuthenticated ? '/' : { name: 'login' }" class="mb-btn-primary mb-btn-lg w-full">
        {{ session.isAuthenticated ? 'Continue' : 'Sign in' }}
      </RouterLink>
    </div>

    <div v-else class="mt-4 space-y-4 text-sm text-surface-500" role="alert">
      <p>{{ token ? error : 'This link is not complete.' }}</p>
      <p>
        Links work once and for a day. Change the address again in your profile, or try to sign
        in to get a new link.
      </p>
      <RouterLink :to="{ name: 'login' }" class="mb-btn-outline mb-btn-lg w-full">Sign in</RouterLink>
    </div>
  </AuthLayout>
</template>
