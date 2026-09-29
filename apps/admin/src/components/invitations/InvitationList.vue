<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import CopyField from '@manablox/admin-sdk/components/ui/CopyField.vue';
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import { formatDate } from '@manablox/admin-sdk/lib/format';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { computed, ref } from 'vue';
import { type Invitation, invitations, useInvitations } from '~/features/invitations/queries';

/** Open invitations of a space, or of the instance with `null`, with resend and revoke. */
const props = withDefaults(
  defineProps<{
    spaceId: string | null;
    /** Offers resend and revoke. */
    manage?: boolean;
  }>(),
  { manage: true },
);

const { data, isPending, error: loadError, refetch } = useInvitations(() => props.spaceId);
const error = ref<string | null>(null);
/** A fresh link when no mail carried it. */
const link = ref<string | null>(null);

/** Pending and expired ones; accepted and revoked ones live in the activity log. */
const open = computed(() =>
  (data.value ?? []).filter((entry) => entry.status === 'pending' || entry.status === 'expired'),
);

function spacesOf(entry: Invitation): string {
  const names = entry.grants.map(
    (grant) => `${grant.spaceName ?? 'Removed space'} (${grant.role})`,
  );
  return names.length ? names.join(', ') : 'No spaces';
}

function resend(entry: Invitation) {
  return runWrite(
    async () => {
      link.value = (await invitations.resend(entry.id)).link;
    },
    { error, success: () => (link.value ? 'New link created' : `Sent again to ${entry.email}`) },
  );
}

function revoke(entry: Invitation) {
  return confirmAndRun(
    {
      title: `Revoke the invitation for ${entry.email}?`,
      message: 'The link stops working. You can invite them again later.',
      confirmLabel: 'Revoke',
      danger: true,
    },
    () => invitations.revoke(entry.id),
    { error, success: 'Invitation revoked' },
  );
}
</script>

<template>
  <div>
    <AsyncList
      :pending="isPending"
      :error="loadError"
      :retry="refetch"
      :items="open"
      list-class="text-sm"
      item-class="flex items-center gap-2 py-2"
    >
      <template #empty><p class="mb-hint">No open invitations.</p></template>
      <template #item="{ item: entry }">
        <Icon name="mail" class="mb-icon-sm shrink-0 text-surface-400" />
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ entry.email }}</span>
          <span class="block truncate mb-meta">
            {{ spaceId ? `As ${entry.grants.find((grant) => grant.spaceId === spaceId)?.role ?? 'member'}` : spacesOf(entry) }}
            -
            {{ entry.status === 'expired' ? 'expired' : `until ${formatDate(entry.expiresAt)}` }}
          </span>
        </span>
        <span v-if="entry.status === 'expired'" class="mb-badge-warn shrink-0">Expired</span>
        <template v-if="manage">
          <button type="button" class="mb-btn-ghost mb-btn-sm shrink-0" @click="resend(entry)">
            <Icon name="send" class="mb-icon-sm" /> Resend
          </button>
          <IconButton icon="trash" :label="`Revoke the invitation for ${entry.email}`" danger class="shrink-0" @click="revoke(entry)" />
        </template>
      </template>
    </AsyncList>
    <p v-if="error" class="mb-error mt-2">{{ error }}</p>

    <FormDialog v-if="link" title="New invitation link" submit-label="Done" :on-submit="() => true" @close="link = null">
      <p class="text-sm text-surface-500">
        This instance cannot send mail. Send this link yourself; the previous one no longer works.
      </p>
      <CopyField :value="link" label="Invitation link" url />
    </FormDialog>
  </div>
</template>
