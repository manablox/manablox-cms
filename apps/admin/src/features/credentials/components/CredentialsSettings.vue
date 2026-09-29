<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import CredentialDialog from '@manablox/admin-sdk/features/credentials/components/CredentialDialog.vue';
import {
  credentials as actions,
  CREDENTIAL_PAGE_SIZE,
  type CredentialView,
  useCredentialPage,
} from '@manablox/admin-sdk/features/credentials/queries';
import { requireSpace } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { CREDENTIAL_KIND_SPECS } from '@manablox/core';
import { computed, ref } from 'vue';

/** The space's credentials. Secrets are write-only; the server returns the last four characters. */
const spaces = useSpaceStore();
const { data, isPending, error, refetch, page, total } = useCredentialPage();
const items = computed(() => data.value?.items);

const editing = ref<CredentialView | null>(null);
const open = ref(false);

function start(credential: CredentialView | null) {
  editing.value = credential;
  open.value = true;
}

function remove(credential: CredentialView) {
  return confirmAndRun(
    {
      title: `Remove "${credential.name}"?`,
      message: 'Anything that signs in with it will fail until another is chosen.',
      confirmLabel: 'Remove credential',
      danger: true,
    },
    () => actions.remove(requireSpace(), credential.id),
    { success: `Removed "${credential.name}"` },
  );
}
</script>

<template>
  <Panel
    title="Credentials"
    description="What this space signs in with when it calls something outside. Stored encrypted with the instance secret, and never sent back to this browser."
    size="lg"
    :card="false"
  >
    <template #actions>
      <button type="button" class="mb-btn-primary shrink-0" @click="start(null)">
        <Icon name="plus" /> Add
      </button>
    </template>

    <AsyncList
      :pending="isPending"
      :error="error"
      :retry="refetch"
      :items="items"
      v-model:page="page"
      :total="total"
      :page-size="CREDENTIAL_PAGE_SIZE"
      empty-icon="key"
      empty-title="No credentials yet"
      empty-description="Add one to call an API, send from a mail account, or post to a service."
      empty="block"
      item-class="flex items-center gap-3 py-3"
    >
      <template #item="{ item: credential }">
        <span class="mb-tile-clay flex h-9 w-9 shrink-0 items-center justify-center rounded-card">
          <Icon name="key" class="mb-icon" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{{ credential.name }}</span>
            <StatusBadge
              v-if="credential.source === 'code'"
              status="code"
              :title="`Declared by ${credential.sourceRef ?? 'the config'}. Its secret is still yours to fill in.`"
            />
          </p>
          <p class="truncate mb-meta">
            {{ CREDENTIAL_KIND_SPECS[credential.kind].label }}
            <span v-if="credential.hint" class="font-mono"> - ends ...{{ credential.hint }}</span>
            <span v-else-if="credential.source === 'code'"> - no secret yet</span>
          </p>
        </div>
        <!-- Config-declared slots can be filled in here but only removed in config. -->
        <button type="button" class="mb-btn-ghost" @click="start(credential)">Edit</button>
        <IconButton
          v-if="credential.source !== 'code'"
          icon="trash"
          :label="`Remove ${credential.name}`"
          title="Remove"
          danger
          @click="remove(credential)"
        />
      </template>
    </AsyncList>

    <CredentialDialog v-if="open && spaces.currentId" :credential="editing" :space-id="spaces.currentId" @close="open = false" />
  </Panel>
</template>
