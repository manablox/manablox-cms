<script setup lang="ts">
import ConfirmDialog from '@manablox/admin-sdk/components/ui/ConfirmDialog.vue';
import { suspension } from '@manablox/admin-sdk/lib/control-messages';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, watch } from 'vue';
import { RouterView, useRouter } from 'vue-router';
import FeatureLockedDialog from '~/components/feature/FeatureLockedDialog.vue';
import SuspendedPanel from '~/components/feature/SuspendedPanel.vue';
import ShortcutsDialog from '~/components/ShortcutsDialog.vue';
import Toaster from '~/components/Toaster.vue';

const session = useSessionStore();
const router = useRouter();
/** A suspended instance shows every signed-in user only its message. */
const suspended = computed(() => suspension(session.me) !== null);

// A policy that starts covering the account mid-session sends it to enrolment.
watch(
  () => session.me?.twoFactor?.pending === true,
  (pending) => {
    const current = router.currentRoute.value;
    if (!pending || current.name === 'two-factor-setup' || current.meta.public) return;
    void router.replace({ name: 'two-factor-setup', query: { redirect: current.fullPath } });
  },
);
</script>

<template>
  <SuspendedPanel v-if="suspended" />
  <RouterView v-else v-slot="{ Component }">
    <Transition name="page" mode="out-in">
      <component :is="Component" />
    </Transition>
  </RouterView>
  <!-- Mounted once above every route, including login and install. -->
  <ConfirmDialog />
  <FeatureLockedDialog />
  <ShortcutsDialog />
  <Toaster />
</template>
