<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { ref } from 'vue';
import InvitationList from '~/components/invitations/InvitationList.vue';
import InviteDialog from '~/components/invitations/InviteDialog.vue';
import RoleSelect from '~/components/RoleSelect.vue';
import { members, useMembers } from '../queries';
import AddMembersDialog from './AddMembersDialog.vue';

/** A space's members, a section of its settings. */
const props = defineProps<{ spaceId: string }>();

const session = useSessionStore();
const error = ref<string | null>(null);
const adding = ref(false);
const inviting = ref(false);

const { data: list, isPending, error: loadError, refetch } = useMembers(() => props.spaceId);

function setRole(userId: string, role: string) {
  return runWrite(() => members.setRole(props.spaceId, userId, role), {
    success: `Role changed to ${role}`,
    error,
  });
}

function remove(userId: string, label: string) {
  return confirmAndRun(
    {
      title: `Remove ${label}?`,
      message: 'They lose access to this space. Their account and other spaces are untouched.',
      confirmLabel: 'Remove member',
      danger: true,
    },
    () => members.remove(props.spaceId, userId),
    { success: `Removed ${label}`, error },
  );
}
</script>

<template>
  <Panel
    title="Members"
    description="The people who work in this space and the role each one has here."
    size="lg"
    :card="false"
  >
    <template #actions>
      <div v-if="session.can('user:write', spaceId)" class="flex shrink-0 gap-2">
        <button class="mb-btn-outline" @click="inviting = true">
          <Icon name="mail" /> Invite
        </button>
        <button class="mb-btn-primary" @click="adding = true">
          <Icon name="plus" /> Add members
        </button>
      </div>
    </template>

    <div class="mb-card">

      <AsyncList
        :pending="isPending"
        :error="loadError"
        :retry="refetch"
        :items="list"
        list-class="text-sm"
        item-class="flex items-center gap-2 py-2"
      >
        <template #empty><p class="mb-hint">No members yet.</p></template>
        <template #item="{ item: member }">
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ member.user.name || member.user.email }}</span>
            <span v-if="member.user.name" class="block truncate mb-meta">
              {{ member.user.email }}
            </span>
          </span>
          <RoleSelect
            class="w-36 shrink-0"
            :space-id="spaceId"
            :model-value="member.role"
            :disabled="!session.can('user:write', spaceId)"
            variant="sm"
            @update:model-value="setRole(member.userId, $event)"
          />
          <IconButton
            v-if="session.can('user:write', spaceId)"
            icon="trash"
            :label="`Remove ${member.user.name || member.user.email}`"
            danger
            @click="remove(member.userId, member.user.name || member.user.email)"
          />
        </template>
      </AsyncList>

      <p v-if="error" class="mb-error mt-2">{{ error }}</p>
      <p class="mb-hint mt-2">
        An <strong>author</strong> can write and delete but not publish; a
        <strong>viewer</strong> is read-only. Other roles are defined under Settings -> Roles.
        A space always keeps at least one owner.
      </p>
    </div>

    <Panel
      v-if="session.can('user:read', spaceId)"
      class="mt-6"
      title="Invitations"
      description="People invited by email who have not joined yet."
      :card="false"
    >
      <div class="mb-card">
        <InvitationList :space-id="spaceId" :manage="session.can('user:write', spaceId)" />
      </div>
    </Panel>

    <AddMembersDialog v-if="adding" :space-id="spaceId" @close="adding = false" />
    <InviteDialog v-if="inviting" :space-id="spaceId" @close="inviting = false" />
  </Panel>
</template>
