<script setup lang="ts">
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { ref } from 'vue';
import RoleSelect from '~/components/RoleSelect.vue';
import { members, useMemberCandidates } from '../queries';

const props = defineProps<{ spaceId: string }>();
const emit = defineEmits<{ close: [] }>();

const search = ref('');
const picked = ref<string[]>([]);
const role = ref('editor');
const error = ref<string | null>(null);

// Only fetched while open.
const { data: candidates } = useMemberCandidates(search, true, () => props.spaceId);

function toggle(userId: string) {
  const at = picked.value.indexOf(userId);
  picked.value = at === -1 ? [...picked.value, userId] : picked.value.filter((id) => id !== userId);
}

function submit() {
  const userIds = [...picked.value];
  if (!userIds.length) return false;
  return runWrite(() => members.add(props.spaceId, userIds, role.value), {
    success: userIds.length === 1 ? 'Member added' : `${userIds.length} members added`,
    error,
  });
}
</script>

<template>
  <FormDialog
    title="Add members"
    :submit-label="picked.length ? `Add ${picked.length}` : 'Add'"
    busy-label="Adding..."
    :disabled="!picked.length"
    form-class="space-y-3"
    :on-submit="submit"
    @close="emit('close')"
  >
    <SearchField v-model="search" label="Search people" placeholder="Search by name or email..." />

    <ul class="max-h-64 mb-list-divided overflow-y-auto text-sm">
      <li v-for="candidate in candidates ?? []" :key="candidate.id">
        <Checkbox class="cursor-pointer py-2" :model-value="picked.includes(candidate.id)" @update:model-value="toggle(candidate.id)">
          <span class="min-w-0 flex-1">
            <span class="block truncate">{{ candidate.name || candidate.email }}</span>
            <span v-if="candidate.name" class="block truncate mb-meta">
              {{ candidate.email }}
            </span>
          </span>
        </Checkbox>
      </li>
    </ul>
    <p v-if="!candidates?.length" class="mb-hint">
      {{ search ? 'No one matches.' : 'Everyone with an account is already a member of this space.' }}
    </p>

    <FormField label="Role" hint="Everyone picked here gets this role; change it per person afterwards." v-slot="{ id }">
      <RoleSelect :id="id" v-model="role" :space-id="spaceId" />
    </FormField>
    <p v-if="error" class="mb-error">{{ error }}</p>
  </FormDialog>
</template>
