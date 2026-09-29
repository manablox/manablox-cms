<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import Tabs from '@manablox/admin-sdk/components/ui/Tabs.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, type Ref, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NotificationsSection from '~/features/notifications/components/NotificationsSection.vue';
import PreferencesForm from '~/features/notifications/components/PreferencesForm.vue';
import TwoFactorSection from '~/features/users/components/TwoFactorSection.vue';
import { profile as account } from '~/features/users/queries';

/** The caller's profile, password, two-factor and notification preferences. */
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

type Tab = 'account' | 'security' | 'notifications';
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
];
const tab = ref<Tab>(TABS.find((item) => item.id === route.query.tab)?.id ?? 'account');
watch(tab, (next) => router.replace({ query: next === 'account' ? {} : { tab: next } }));

// --- profile -------------------------------------------------------------

const profile = useDraftForm<{ name: string; email: string }>();
const form = profile.draft as Ref<{ name: string; email: string }>;
watch(
  () => session.me,
  (me) => {
    if (me) profile.load({ name: me.name, email: me.email }, { keepEdits: true });
  },
  { immediate: true },
);

async function saveProfile() {
  await profile.submit(async () => {
    const updated = await account.update({
      name: form.value.name.trim(),
      email: form.value.email.trim(),
    });
    profile.load({ name: updated.name, email: updated.email });
    await session.refresh();
    toast.success(
      updated.emailChange?.status === 'sent'
        ? `Saved - open the link we sent to ${updated.emailChange.email} to use it`
        : 'Profile saved',
    );
  });
}

// --- password ------------------------------------------------------------

const password = useDraftForm<{ current: string; next: string; again: string }>();
password.load({ current: '', next: '', again: '' });
const pw = password.draft as Ref<{ current: string; next: string; again: string }>;
const mismatch = computed(() => pw.value.again.length > 0 && pw.value.next !== pw.value.again);
const canChange = computed(
  () =>
    pw.value.current.length > 0 && pw.value.next.length >= 12 && pw.value.next === pw.value.again,
);

async function changePassword() {
  if (!canChange.value) return;
  await password.submit(async () => {
    await account.changePassword(pw.value.current, pw.value.next);
    password.load({ current: '', next: '', again: '' });
    toast.success('Password changed');
  });
}

const initials = computed(() => {
  const source = session.me?.name || session.me?.email || '?';
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
});
</script>

<template>
  <div class="mb-page-wide">
    <PageHeader :title="session.me?.name || session.me?.email || 'Profile'" eyebrow="Your profile" :description="session.me?.email ?? ''">
      <template #badge>
        <span class="mb-badge-brand">{{ session.isSuperadmin ? 'administrator' : 'member' }}</span>
      </template>
    </PageHeader>

    <Tabs v-model="tab" class="mb-6" :tabs="TABS" aria-label="Profile" />

    <div v-if="tab === 'account'" class="grid gap-4 xl:grid-cols-2">
      <section class="mb-card">
        <div class="mb-4 flex items-center gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-iris-100 text-sm font-bold text-iris-700 dark:bg-iris-500/25 dark:text-iris-100">
            {{ initials }}
          </span>
          <div>
            <h2 class="text-sm font-bold">Who you are</h2>
            <p class="mb-meta">Your name is what others see in the activity log and in what they are told.</p>
          </div>
        </div>
        <form class="space-y-3" @submit.prevent="saveProfile">
          <TextField v-model="form.name" label="Name" required autocomplete="name" />
          <TextField
            v-model="form.email"
            label="Email"
            type="email"
            required
            autocomplete="email"
            :error="profile.fieldError(['email'])"
            hint="You sign in with it, and notifications by email go to it. A new address may first need confirming from a link we mail to it."
          />
          <p v-for="message in profile.otherErrors([['email']])" :key="message" class="mb-error">{{ message }}</p>
          <div class="flex justify-end">
            <SaveButton type="submit" :saving="profile.saving.value" :disabled="!profile.isDirty.value" />
          </div>
        </form>
      </section>

      <section class="mb-card">
        <div class="mb-4 flex items-center gap-3">
          <span class="mb-tile-sand flex h-10 w-10 shrink-0 items-center justify-center rounded-card">
            <Icon name="lock" class="mb-icon-lg" />
          </span>
          <div>
            <h2 class="text-sm font-bold">Password</h2>
            <p class="mb-meta">At least 12 characters. Your other devices stay signed in.</p>
          </div>
        </div>
        <form class="space-y-3" @submit.prevent="changePassword">
          <TextField
            v-model="pw.current"
            label="Current password"
            type="password"
            required
            autocomplete="current-password"
            :error="password.fieldError(['currentPassword'])"
          />
          <TextField
            v-model="pw.next"
            label="New password"
            type="password"
            required
            minlength="12"
            autocomplete="new-password"
            :error="password.fieldError(['password'])"
          />
          <TextField
            v-model="pw.again"
            label="New password, again"
            type="password"
            required
            autocomplete="new-password"
            :error="mismatch ? 'The two do not match.' : ''"
          />
          <p v-for="message in password.otherErrors([['currentPassword'], ['password']])" :key="message" class="mb-error">{{ message }}</p>
          <div class="flex justify-end">
            <SaveButton type="submit" label="Change password" saving-label="Changing..." :saving="password.saving.value" :disabled="!canChange" />
          </div>
        </form>
      </section>
    </div>

    <div v-else-if="tab === 'security'" class="grid gap-4 xl:grid-cols-2">
      <TwoFactorSection />
    </div>

    <div v-else class="space-y-4">
      <PreferencesForm />
      <NotificationsSection />
    </div>
  </div>
</template>
