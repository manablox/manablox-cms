<script setup lang="ts">
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import CopyField from '@manablox/admin-sdk/components/ui/CopyField.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { detailAt, errorDetails } from '@manablox/admin-sdk/lib/api-errors';
import { messageFor, messageForKey } from '@manablox/admin-sdk/lib/messages';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import RoleSelect from '~/components/RoleSelect.vue';
import { invitations } from '~/features/invitations/queries';

/**
 * Invites someone by email. With `spaceId` the invitation grants a role in that space; without
 * (superadmins) any spaces, or none. Without mail the link is shown to copy.
 */
const props = defineProps<{ spaceId?: string | undefined }>();
const emit = defineEmits<{ close: [] }>();

const spaces = useSpaceStore();
const email = ref('');
/** Space id -> role, for the spaces picked. */
const roles = ref<Record<string, string>>(props.spaceId ? { [props.spaceId]: 'editor' } : {});
const error = ref<string | null>(null);
const emailError = ref<string | null>(null);
/** Set when no mail carried the invitation. */
const link = ref<string | null>(null);

const choices = computed(() =>
  props.spaceId ? spaces.spaces.filter((space) => space.id === props.spaceId) : spaces.spaces,
);

function toggle(spaceId: string) {
  const next = { ...roles.value };
  if (next[spaceId]) delete next[spaceId];
  else next[spaceId] = 'editor';
  roles.value = next;
}

function setRole(spaceId: string, role: string) {
  roles.value = { ...roles.value, [spaceId]: role };
}

function describe(err: unknown): string {
  const atEmail = detailAt(errorDetails(err), ['email']);
  if (atEmail) {
    emailError.value = messageForKey(atEmail.key, atEmail.params);
    return emailError.value;
  }
  const message = messageFor(err);
  error.value = message;
  return message;
}

async function submit() {
  if (link.value) return true;
  error.value = null;
  emailError.value = null;
  const address = email.value.trim();
  const done = await runWrite(
    async () => {
      const issued = await invitations.create({
        email: address,
        grants: Object.entries(roles.value).map(([spaceId, role]) => ({ spaceId, role })),
      });
      link.value = issued.link;
      return issued;
    },
    {
      describe,
      success: (issued) =>
        issued.link ? 'Invitation created - copy the link' : `Invitation sent to ${address}`,
    },
  );
  // Stays open to show the link.
  return done && !link.value;
}
</script>

<template>
  <FormDialog
    title="Invite someone"
    :submit-label="link ? 'Done' : 'Send invitation'"
    busy-label="Inviting..."
    :disabled="!link && (!email.trim() || (Boolean(spaceId) && !Object.keys(roles).length))"
    form-class="space-y-3"
    :on-submit="submit"
    @close="emit('close')"
  >
    <template v-if="link">
      <p class="text-sm text-surface-500">
        This instance cannot send mail. Send this link to {{ email.trim() }} yourself; it works
        once and is shown only now.
      </p>
      <CopyField :value="link" label="Invitation link" url data-testid="invite-link" />
    </template>

    <template v-else>
      <TextField
        v-model="email"
        label="Email"
        type="email"
        required
        autocomplete="off"
        :error="emailError"
        hint="They get a link to set up an account, or to sign in if they have one."
      />

      <FormField
        :label="spaceId ? 'Role' : 'Spaces'"
        :hint="spaceId ? undefined : 'Pick the spaces they join and their role in each. Without any, they only get an account.'"
      >
        <ul class="mb-list-divided text-sm">
          <li v-for="space in choices" :key="space.id" class="flex items-center gap-2 py-2">
            <Checkbox v-if="!spaceId" class="min-w-0 flex-1" :model-value="Boolean(roles[space.id])" @update:model-value="toggle(space.id)">
              <span class="truncate">{{ space.name }}</span>
            </Checkbox>
            <span v-else class="min-w-0 flex-1 truncate">{{ space.name }}</span>
            <RoleSelect
              v-if="roles[space.id]"
              class="w-36 shrink-0"
              :space-id="space.id"
              :model-value="roles[space.id] as string"
              variant="sm"
              @update:model-value="setRole(space.id, $event)"
            />
          </li>
        </ul>
      </FormField>
      <p v-if="error" class="mb-error" role="alert">{{ error }}</p>
    </template>
  </FormDialog>
</template>
