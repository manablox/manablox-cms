<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EditorHeader from '@manablox/admin-sdk/components/layout/EditorHeader.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { formatDate } from '@manablox/admin-sdk/lib/format';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, type Ref, ref, watch } from 'vue';
import { INSTANCE_ROLES, type InstanceRole, users, useUser } from '../queries';
import SetPasswordDialog from './SetPasswordDialog.vue';
import UserMembershipsSection from './UserMembershipsSection.vue';

/** One account's profile, role, memberships, actions and deletion. */
const props = defineProps<{ userId: string }>();
const emit = defineEmits<{ deleted: [] }>();

const session = useSessionStore();
const { data: user, isPending, error: loadError, refetch } = useUser(() => props.userId);

const isSelf = computed(() => user.value?.id === session.me?.id);
const label = computed(() => user.value?.name || user.value?.email || 'this account');

const editor = useDraftForm<{ name: string; email: string }>();
editor.load({ name: '', email: '' });
const form = editor.draft as Ref<{ name: string; email: string }>;
const { isDirty, saving } = editor;
watch(
  user,
  (next) => {
    if (next) editor.load({ name: next.name, email: next.email }, { keepEdits: true });
  },
  { immediate: true },
);

const resetting = ref(false);

async function save() {
  await editor.submit(async () => {
    const updated = await users.update(props.userId, {
      name: form.value.name.trim(),
      email: form.value.email.trim(),
    });
    editor.load({ name: updated.name, email: updated.email });
    if (isSelf.value) await session.refresh();
    toast.success('Profile saved');
  });
}

function setRole(role: string) {
  const name = INSTANCE_ROLES.find((option) => option.value === role)?.label.toLowerCase() ?? role;
  return runWrite(
    async () => {
      await users.setRole(props.userId, role as InstanceRole);
      if (isSelf.value) await session.refresh();
    },
    { success: `Now ${name}` },
  );
}

function signOutEverywhere() {
  return confirmAndRun(
    {
      title: `Sign ${label.value} out everywhere?`,
      message: 'Every device they are signed in on is signed out. They can sign in again at once.',
      confirmLabel: 'Sign out everywhere',
    },
    () => users.revokeSessions(props.userId),
    { success: `${label.value} signed out everywhere` },
  );
}

function ban() {
  return confirmAndRun(
    {
      title: `Ban ${label.value}?`,
      message:
        'They are signed out everywhere and cannot sign in until the ban is lifted. Nothing they made is touched.',
      confirmLabel: 'Ban account',
      danger: true,
    },
    () => users.ban(props.userId, ''),
    { success: `Banned ${label.value}` },
  );
}

function unban() {
  return runWrite(() => users.unban(props.userId), {
    success: `Lifted the ban on ${label.value}`,
  });
}

function remove() {
  return confirmAndRun(
    {
      title: `Delete ${label.value}?`,
      message:
        'The account, its sessions, API keys and memberships are removed. Content they wrote stays.',
      confirmLabel: 'Delete account',
      danger: true,
      requireText: user.value?.email ?? '',
    },
    async () => {
      await users.remove(props.userId);
      emit('deleted');
    },
    { success: `Deleted ${label.value}` },
  );
}
</script>

<template>
  <PageState :ready="Boolean(user)" :loading="isPending" :error="loadError" :retry="refetch" not-found-title="No such account" not-found-icon="users" :not-found="!isPending && !loadError && !user" loading-label="Loading account...">
    <div v-if="user" class="min-w-0 space-y-4">
      <EditorHeader :title="user.name || user.email" :eyebrow="user.email" class="mb-0!">
        <template #badge>
          <span v-if="isSelf" class="mb-badge">you</span>
          <span v-if="user.banned" class="mb-badge-warn">banned</span>
          <span class="mb-badge-brand">
            {{ (INSTANCE_ROLES.find((option) => option.value === user?.role)?.label ?? user.role).toLowerCase() }}
          </span>
        </template>
      </EditorHeader>

      <div class="grid gap-4 xl:grid-cols-2">
        <Panel title="Profile" heading="h3">
          <form class="space-y-3" @submit.prevent="save">
            <TextField v-model="form.name" label="Name" required />
            <TextField v-model="form.email" label="Email" type="email" required :error="editor.fieldError(['email'])" />
            <FormField
              label="Instance role"
              hint="An administrator reaches every space and manages users. The instance always keeps at least one."
              v-slot="{ id }"
            >
              <Select :id="id" :model-value="user.role" :options="INSTANCE_ROLES" @update:model-value="setRole" />
            </FormField>
            <p v-for="message in editor.otherErrors([['email']])" :key="message" class="mb-error">{{ message }}</p>
            <div class="flex justify-end">
              <SaveButton type="submit" :saving="saving" :disabled="!isDirty" />
            </div>
          </form>
        </Panel>

        <UserMembershipsSection :user-id="user.id" :label="label" :memberships="user.memberships" />
      </div>

      <Panel title="Access" :description="`Joined ${formatDate(user.createdAt)}.`" heading="h3">
        <p v-if="user.banned" class="mb-3 text-sm text-surface-500">
          This account is banned<template v-if="user.banReason">: {{ user.banReason }}</template>.
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="mb-btn-outline" @click="resetting = true"><Icon name="lock" /> Reset password</button>
          <button type="button" class="mb-btn-outline" @click="signOutEverywhere"><Icon name="logout" /> Sign out everywhere</button>
          <button v-if="user.banned" type="button" class="mb-btn-outline" @click="unban"><Icon name="check" /> Lift ban</button>
          <button v-else-if="!isSelf" type="button" class="mb-btn-ghost-danger" @click="ban">
            <Icon name="ban" /> Ban
          </button>
        </div>
      </Panel>

      <Panel
        v-if="!isSelf"
        title="Delete this account"
        description="Removes the account, its sessions, API keys and memberships. Content stays. You will be asked to type its email."
        heading="h3"
      >
        <template #actions>
          <button type="button" class="mb-btn-ghost-danger shrink-0" @click="remove">
            <Icon name="trash" /> Delete account
          </button>
        </template>
      </Panel>

      <SetPasswordDialog v-if="resetting" :user-id="user.id" :label="label" @close="resetting = false" />
    </div>
  </PageState>
</template>
