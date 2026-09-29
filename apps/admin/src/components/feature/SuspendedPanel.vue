<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import { adminLinks, suspension } from '@manablox/admin-sdk/lib/control-messages';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useEventListener } from '@vueuse/core';
import { computed, ref } from 'vue';
import Logo from '~/components/Logo.vue';

/** Everything a suspended instance shows once signed in: the message, the links and a way out. */
const session = useSessionStore();

const message = computed(
  () => suspension(session.me) || 'Nothing can be viewed or changed at the moment.',
);
const links = computed(() => adminLinks(session.me));
const checking = ref(false);

async function checkAgain() {
  checking.value = true;
  try {
    await session.revalidate(true);
  } finally {
    checking.value = false;
  }
}

// Lifted through the control API at any time.
useEventListener(window, 'focus', () => void session.revalidate());

async function signOut() {
  await session.signOut();
  // Full reload discards every store and cached query.
  window.location.assign('/login');
}
</script>

<template>
  <main class="flex min-h-full items-center justify-center p-8" data-testid="suspended-panel">
    <div class="mb-card w-full max-w-lg text-center">
      <Logo :size="48" class="mx-auto" />
      <p class="mb-eyebrow mt-6">Suspended</p>
      <h1 class="mb-title mt-1">This instance is suspended</h1>
      <p class="mt-3 whitespace-pre-line text-sm text-surface-600 dark:text-surface-300">{{ message }}</p>
      <ul v-if="links.length" class="mt-6 flex flex-wrap justify-center gap-2">
        <li v-for="link in links" :key="link.key">
          <a :href="link.href" target="_blank" rel="noopener noreferrer" class="mb-btn-outline">
            <Icon :name="link.icon" class="mb-icon-sm" />
            {{ link.label }}
          </a>
        </li>
      </ul>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" class="mb-btn-primary" :disabled="checking" @click="checkAgain">Check again</button>
        <button type="button" class="mb-btn-ghost" @click="signOut">
          <Icon name="logout" class="mb-icon-sm" />
          Sign out
        </button>
      </div>
    </div>
  </main>
</template>
