<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import RoleSelect from '~/components/RoleSelect.vue';
import { members } from '~/features/spaces/queries';

/** A user's space memberships, a section of their detail. Writes use the space procedures, so the last-owner rule holds. */
const props = defineProps<{
  userId: string;
  label: string;
  memberships: Array<{ spaceId: string; role: string; space: { id: string; name: string } }>;
}>();

const spaces = useSpaceStore();
const error = ref<string | null>(null);

const addSpaceId = ref('');
const addRole = ref('editor');

/** Spaces the account is not in. */
const candidates = computed(() => {
  const taken = new Set(props.memberships.map((membership) => membership.spaceId));
  return spaces.spaces
    .filter((space) => !taken.has(space.id))
    .map((space) => ({ value: space.id, label: space.name, hint: space.machineName }));
});

function add() {
  const spaceId = addSpaceId.value;
  if (!spaceId) return;
  const spaceName = spaces.spaces.find((s) => s.id === spaceId)?.name ?? 'the space';
  return runWrite(
    async () => {
      await members.add(spaceId, [props.userId], addRole.value);
      addSpaceId.value = '';
    },
    { success: `Added ${props.label} to ${spaceName}`, error },
  );
}

function setRole(spaceId: string, role: string) {
  return runWrite(() => members.setRole(spaceId, props.userId, role), {
    success: `Role changed to ${role}`,
    error,
  });
}

function remove(spaceId: string, spaceName: string) {
  return confirmAndRun(
    {
      title: `Remove ${props.label} from ${spaceName}?`,
      message: 'They lose access to this space. Their account and other spaces are untouched.',
      confirmLabel: 'Remove',
      danger: true,
    },
    () => members.remove(spaceId, props.userId),
    { success: `Removed from ${spaceName}`, error },
  );
}
</script>

<template>
  <Panel title="Spaces" heading="h3">
    <ul class="mb-list-divided text-sm">
      <li v-for="membership in memberships" :key="membership.spaceId" class="flex items-center gap-2 py-2">
        <span class="min-w-0 flex-1 truncate">{{ membership.space.name }}</span>
        <RoleSelect
          class="w-36 shrink-0"
          :space-id="membership.spaceId"
          :model-value="membership.role"
          variant="sm"
          @update:model-value="setRole(membership.spaceId, $event)"
        />
        <IconButton icon="trash" :label="`Remove from ${membership.space.name}`" danger @click="remove(membership.spaceId, membership.space.name)" />
      </li>
    </ul>
    <p v-if="!memberships.length" class="mb-hint">Not a member of any space.</p>

    <form v-if="candidates.length" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="add">
      <FormField label="Add to space" class="min-w-40 flex-1" v-slot="{ id }">
        <Select :id="id" v-model="addSpaceId" :options="candidates" placeholder="Pick a space..." />
      </FormField>
      <FormField label="Role" v-slot="{ id }">
        <RoleSelect v-if="addSpaceId" :id="id" v-model="addRole" :space-id="addSpaceId" />
        <Select v-else :id="id" :model-value="addRole" :options="[{ value: addRole, label: addRole }]" disabled />
      </FormField>
      <button type="submit" class="mb-btn-outline" :disabled="!addSpaceId"><Icon name="plus" /> Add</button>
    </form>

    <p v-if="error" class="mb-error mt-2">{{ error }}</p>
  </Panel>
</template>
