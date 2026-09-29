<script setup lang="ts">
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useRoute, useRouter } from 'vue-router';
import AuthLayout from '~/components/AuthLayout.vue';
import TwoFactorEnrol from '~/features/users/components/TwoFactorEnrol.vue';

/** Enrolment the two-factor policy asks for before anything else. */
const session = useSessionStore();
const router = useRouter();
const route = useRoute();

async function done() {
  await session.refresh();
  await router.replace((route.query.redirect as string) ?? '/');
}

async function signOut() {
  await session.signOut();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <AuthLayout size="wide">
    <template #panel>
      <h1 class="font-display text-4xl leading-[1.05] font-bold tracking-tight lg:text-5xl">
        <span class="text-brand-100">A second lock</span><br />
        on your account.
      </h1>
      <p class="mt-4 max-w-sm text-sm text-brand-50">
        This instance asks for two-factor authentication. Set it up once; afterwards you enter a
        code from your phone when you sign in.
      </p>
    </template>

    <p class="mb-eyebrow">Two-factor authentication</p>
    <h2 class="mb-title mt-1">Set up two-factor authentication</h2>
    <p class="mt-2 mb-6 text-sm text-surface-500">
      Signed in as {{ session.me?.email }}. You can continue once it is on.
    </p>

    <TwoFactorEnrol @done="done" />

    <p class="mt-6 text-sm text-surface-500">
      <button type="button" class="mb-link" @click="signOut">
        Sign out
      </button>
    </p>
  </AuthLayout>
</template>
