<script setup lang="ts">
import SettingsPage from '@manablox/admin-sdk/components/layout/SettingsPage.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import NavList from '@manablox/admin-sdk/components/ui/NavList.vue';
import NavListItem from '@manablox/admin-sdk/components/ui/NavListItem.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref, watch } from 'vue';
import MasterDetail from '~/components/layout/MasterDetail.vue';
import { type Role, useRoles } from '../queries';
import RoleCreateDialog from './RoleCreateDialog.vue';
import RoleEditor from './RoleEditor.vue';

/** Settings -> Roles for the current space, as list and detail. */
const spaces = useSpaceStore();

const spaceId = computed(() => spaces.currentId);

const canWrite = useCan('role:write');

const { data: list, isPending, error, refetch } = useRoles();
const builtIn = computed(() => (list.value ?? []).filter((role) => role.builtIn));
const custom = computed(() => (list.value ?? []).filter((role) => !role.builtIn));

/** The selected role's machine name. */
const selectedKey = ref<string>('editor');
const selected = computed<Role | null>(
  () => (list.value ?? []).find((role) => role.machineName === selectedKey.value) ?? null,
);
const creating = ref(false);

watch(spaceId, () => {
  selectedKey.value = 'editor';
});
</script>

<template>
  <SettingsPage
    title="Roles"
    description="A role is a set of permissions: what someone may see and change in this space. Give each person a role under Members."
    wide
  >
    <template #actions>
      <NewButton label="New role" :enabled="canWrite && Boolean(spaceId)" @click="creating = true" />
    </template>

    <MasterDetail
      aria-label="Roles"
      :has-selection="Boolean(spaceId && selected)"
      empty-icon="shield"
      :empty-title="spaceId ? 'Pick a role' : 'No space yet'"
      :empty-description="spaceId ? undefined : 'Create a space to start.'"
    >
      <template #list>
        <AsyncList :pending="Boolean(spaceId) && isPending" :error="error" :retry="refetch" :items="list" empty="bare" empty-title="No roles.">
          <p class="px-2 pt-1 pb-1.5 text-2xs font-semibold tracking-[0.12em] text-surface-500 uppercase">Built-in roles</p>
          <NavList aria-label="Built-in roles">
            <NavListItem v-for="role in builtIn" :key="role.machineName" :active="selectedKey === role.machineName" icon="lock" @select="selectedKey = role.machineName">
              <span class="block truncate text-sm font-medium">{{ role.name }}</span>
              <span v-if="role.description" class="block truncate text-2xs text-surface-500">{{ role.description }}</span>
            </NavListItem>
          </NavList>

          <p class="px-2 pt-4 pb-1.5 text-2xs font-semibold tracking-[0.12em] text-surface-500 uppercase">Custom roles</p>
          <p v-if="!custom.length" class="px-2 pb-1 mb-meta">
            None yet. Use <strong>New role</strong> when the built-in ones do not fit.
          </p>
          <NavList aria-label="Custom roles">
            <NavListItem v-for="role in custom" :key="role.machineName" :active="selectedKey === role.machineName" icon="shield" @select="selectedKey = role.machineName">
              <span class="block truncate text-sm font-medium">{{ role.name }}</span>
              <span class="block truncate text-2xs text-surface-500">{{ role.description || role.machineName }}</span>
            </NavListItem>
          </NavList>
        </AsyncList>
      </template>

      <RoleEditor
        v-if="spaceId && selected"
        :key="`${spaceId}:${selectedKey}`"
        :space-id="spaceId"
        :role="selected"
        :can-write="canWrite"
        @saved="selectedKey = $event.machineName"
        @deleted="selectedKey = 'editor'"
      />
    </MasterDetail>

    <RoleCreateDialog
      v-if="creating && spaceId"
      :space-id="spaceId"
      @close="creating = false"
      @created="selectedKey = $event.machineName"
    />
  </SettingsPage>
</template>
