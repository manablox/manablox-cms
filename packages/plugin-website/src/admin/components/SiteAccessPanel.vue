<script setup lang="ts">
import {
  confirmAndRun,
  FeatureGate,
  FeatureLock,
  runWrite,
  SaveButton,
  TextField,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import { site as actions } from '../queries';

/** The site password: a space setting, live as soon as it is saved. */
const props = defineProps<{
  spaceId: string;
  hasPassword: boolean;
  /** Holds `space:write`. */
  canEdit: boolean;
}>();

/** The server's minimum. */
const MIN_LENGTH = 8;

const password = ref('');
const again = ref('');
const busy = ref(false);
const mismatch = computed(() => again.value.length > 0 && password.value !== again.value);
const canSave = computed(
  () => password.value.length >= MIN_LENGTH && password.value === again.value,
);

async function save() {
  if (!canSave.value) return;
  const changed = props.hasPassword;
  const ok = await runWrite(() => actions.setPassword(props.spaceId, password.value), {
    busy,
    success: changed
      ? 'Password changed - visitors need the new one'
      : 'Password set - the site now asks for it',
  });
  if (ok) {
    password.value = '';
    again.value = '';
  }
}

function remove() {
  return confirmAndRun(
    {
      title: 'Remove the site password?',
      message: 'Everyone can see the site again, and search engines may index it.',
      confirmLabel: 'Remove password',
      danger: true,
    },
    () => actions.setPassword(props.spaceId, null),
    { busy, success: 'Password removed - the site is open' },
  );
}
</script>

<template>
  <div class="ws:space-y-6">
    <section class="ws:space-y-2">
      <span class="mb-label">Password</span>
      <p class="ws:flex ws:flex-wrap ws:items-center ws:gap-2 ws:text-sm">
        <span :class="hasPassword ? 'mb-badge-warn' : 'mb-badge'">{{ hasPassword ? 'Protected' : 'Open' }}</span>
        {{ hasPassword ? 'Visitors enter a password before they see any page.' : 'Everyone can see the site.' }}
      </p>
      <FeatureGate feature="plugins.website.password">
        <template #default>
          <form v-if="canEdit" class="ws:max-w-sm ws:space-y-3" @submit.prevent="save">
            <TextField
              v-model="password"
              :label="hasPassword ? 'New password' : 'Password'"
              type="password"
              required
              :minlength="MIN_LENGTH"
              autocomplete="new-password"
            />
            <TextField
              v-model="again"
              label="Password, again"
              type="password"
              required
              autocomplete="new-password"
              :error="mismatch ? 'The two do not match.' : ''"
            />
            <div class="ws:flex ws:flex-wrap ws:gap-2">
              <SaveButton
                type="submit"
                :label="hasPassword ? 'Change password' : 'Set password'"
                saving-label="Saving..."
                :saving="busy"
                :disabled="!canSave"
              />
              <button v-if="hasPassword" type="button" class="mb-btn-ghost" :disabled="busy" @click="remove">Remove password</button>
            </div>
          </form>
          <p v-else class="mb-callout ws:text-xs">Changing the password needs the right to edit the space.</p>
        </template>
        <template #locked="{ state }">
          <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-2">
            <FeatureLock feature="plugins.website.password" :state="state" :label="hasPassword ? 'Change the password' : 'Set a password'" />
            <span v-if="hasPassword" class="mb-hint">The password stays in place, so the site stays protected.</span>
          </div>
        </template>
      </FeatureGate>
      <p class="mb-hint">
        At least {{ MIN_LENGTH }} characters, shared by everyone you give it to. A new password signs out
        every visitor. Protected pages are never cached for others or indexed; share links still
        open previews. Uploaded files stay reachable by their direct address.
      </p>
    </section>
  </div>
</template>
