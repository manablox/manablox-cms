<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import NavList from '@manablox/admin-sdk/components/ui/NavList.vue';
import NavListItem from '@manablox/admin-sdk/components/ui/NavListItem.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { computed, ref, watch } from 'vue';
import InvitationList from '~/components/invitations/InvitationList.vue';
import InviteDialog from '~/components/invitations/InviteDialog.vue';
import MasterDetail from '~/components/layout/MasterDetail.vue';
import { INSTANCE_ROLES, useUsers } from '../queries';
import UserCreateDialog from './UserCreateDialog.vue';
import UserDetail from './UserDetail.vue';

/** Settings -> Users: all accounts as list and detail; superadmin only. */
const session = useSessionStore();
const search = ref('');
const { data: page, isPending, error, refetch } = useUsers(search);

const selectedId = ref<string | null>(session.me?.id ?? null);
const list = computed(() => page.value?.items ?? []);
const selected = computed(
  () => list.value.find((user) => user.id === selectedId.value) ?? list.value[0] ?? null,
);

const creating = ref(false);
const inviting = ref(false);

// Select the first hit when the selection drops out of the results.
watch(list, (items) => {
  if (items.length && !items.some((user) => user.id === selectedId.value)) {
    selectedId.value = items[0]?.id ?? null;
  }
});

function roleLabel(role: string): string {
  return INSTANCE_ROLES.find((option) => option.value === role)?.label ?? role;
}
</script>

<template>
  <Panel
    title="Users"
    description="Every account on this instance. Administrators reach every space; members reach the spaces they are added to."
    size="lg"
    :card="false"
  >
    <template #actions>
      <div class="flex shrink-0 gap-2">
        <button type="button" class="mb-btn-outline" @click="inviting = true">
          <Icon name="mail" /> Invite
        </button>
        <NewButton label="New user" @click="creating = true" />
      </div>
    </template>

    <MasterDetail
      aria-label="Users"
      :has-selection="Boolean(selected)"
      empty-icon="users"
      empty-title="Pick an account"
      :empty-description="isPending ? undefined : 'Or create one.'"
    >
      <template #filter>
        <SearchField v-model="search" label="Search users" placeholder="Search by name or email..." />
      </template>

      <template #list>
        <AsyncList :pending="isPending" :error="error" :retry="refetch" :items="list">
          <template #empty>
            <p class="px-2 py-3 text-sm text-surface-500">
              {{ search ? 'No one matches.' : 'No accounts yet.' }}
            </p>
          </template>
          <NavList>
            <NavListItem v-for="user in list" :key="user.id" :active="selected?.id === user.id" @select="selectedId = user.id">
              <span class="block truncate text-sm font-semibold" :class="user.banned ? 'line-through opacity-60' : ''">
                {{ user.name || user.email }}
              </span>
              <span class="block truncate mb-meta">{{ user.email }}</span>
              <template #trailing>
                <Icon v-if="user.role === 'superadmin'" name="shield" class="mb-icon-sm shrink-0 text-iris-500" :title="roleLabel(user.role)" />
                <Icon v-if="user.banned" name="ban" class="mb-icon-sm shrink-0 text-danger-500" title="Banned" />
              </template>
            </NavListItem>
          </NavList>
        </AsyncList>
      </template>
      <template #actions>
        <p v-if="page && page.total > list.length" class="mb-hint">
          Showing {{ list.length }} of {{ page.total }} - narrow it with a search.
        </p>
      </template>

      <UserDetail v-if="selected" :key="selected.id" :user-id="selected.id" @deleted="selectedId = null" />
    </MasterDetail>

    <Panel
      class="mt-6"
      title="Invitations"
      description="People invited by email who have not joined yet, across every space."
      :card="false"
    >
      <div class="mb-card">
        <InvitationList :space-id="null" />
      </div>
    </Panel>

    <UserCreateDialog v-if="creating" @close="creating = false" @created="selectedId = $event" />
    <InviteDialog v-if="inviting" @close="inviting = false" />
  </Panel>
</template>
