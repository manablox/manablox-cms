<script setup lang="ts">
import HostVerification from '@manablox/admin-sdk/components/HostVerification.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import FormField from '@manablox/admin-sdk/components/ui/FormField.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import TextField from '@manablox/admin-sdk/components/ui/TextField.vue';
import { useEnvironmentChoice } from '@manablox/admin-sdk/features/environments/useEnvironmentChoice';
import { previewHostname } from '@manablox/admin-sdk/lib/hostnames';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun, runWrite } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import { type ApiHost, apiHosts, useApiHosts } from '../queries';

/**
 * Settings -> API hosts: host names the public API answers this space on, so one public API
 * process serves several spaces.
 */
const spaces = useSpaceStore();
const canManage = useCan('space:write');
const { data, isPending, error: loadError, refetch } = useApiHosts();

const hostname = ref('');
const adding = ref(false);
const error = ref<string | null>(null);
const verifying = ref<string | null>(null);
const preview = computed(() => previewHostname(hostname.value));
/** Hosts belong to one environment; the list shows the open one's. */
const environment = useEnvironmentChoice();

function add() {
  const spaceId = spaces.currentId;
  if (!spaceId || !preview.value) return;
  const name = preview.value;
  const target = environment.target.value;
  const elsewhere = target !== environment.machineName.value;
  return runWrite(() => apiHosts.create(spaceId, name, target), {
    success: elsewhere
      ? `Added ${name} to ${environment.nameOf(target)} - open that environment to see it`
      : `Added ${name}`,
    error,
    busy: adding,
  }).then((ok) => {
    if (ok) hostname.value = '';
  });
}

async function verify(host: ApiHost) {
  verifying.value = host.id;
  try {
    await runWrite(() => apiHosts.verify(requireSpace(), host.id), {
      success: (row) =>
        row.verification.status === 'verified'
          ? `${host.hostname} is verified`
          : `No matching DNS record for ${host.hostname} yet`,
    });
  } finally {
    verifying.value = null;
  }
}

function remove(host: ApiHost) {
  return confirmAndRun(
    {
      title: `Remove ${host.hostname}?`,
      message: 'Requests to it get "unknown host" from the public API.',
      confirmLabel: 'Remove host',
      danger: true,
    },
    () => apiHosts.remove(requireSpace(), host.id),
    { success: `Removed ${host.hostname}` },
  );
}
</script>

<template>
  <Panel
    title="API hosts"
    description="Host names the public API answers this space on. Point each one at the public API; requests are served from this space by the name they use."
    size="lg"
    :card="false"
  >
    <form v-if="canManage" class="mb-3 flex flex-wrap items-end gap-2" @submit.prevent="add">
      <TextField
        v-model="hostname"
        label="Host name"
        placeholder="api.example.com"
        field-class="min-w-0 flex-1"
        :error="error"
      />
      <FormField v-if="environment.choosable.value" v-slot="{ id }" label="Environment" class="w-44">
        <Select :id="id" v-model="environment.target.value" :options="environment.options.value" />
      </FormField>
      <button type="submit" class="mb-btn-primary" :disabled="adding || !preview">
        <Icon name="plus" /> {{ adding ? 'Adding...' : 'Add host' }}
      </button>
    </form>
    <p v-if="environment.labelled.value" class="mb-hint mb-2">Hosts of {{ environment.currentName.value }}; each environment has its own.</p>

    <AsyncList
      :pending="isPending"
      :error="loadError"
      :retry="refetch"
      :items="data"
      empty-icon="globe"
      empty-title="No API hosts yet"
      empty-description="Without one, the public API serves this space only when it is pinned to it or is the only space."
      empty="block"
      list-class="text-sm"
      item-class="py-2"
    >
      <template #item="{ item: host }">
        <div class="flex flex-wrap items-center gap-2">
          <span class="min-w-0 flex-1 truncate font-mono">{{ host.hostname }}</span>
          <span v-if="environment.labelled.value" class="mb-badge" :title="`Serves the ${environment.currentName.value} environment`">{{ environment.currentName.value }}</span>
          <span v-if="host.verification.status === 'pending'" class="mb-badge-warn">not verified</span>
          <span v-else-if="host.verification.status === 'failed'" class="mb-badge-danger">verification failed</span>
          <button v-if="canManage" type="button" class="mb-btn-ghost-danger mb-btn-sm" :aria-label="`Remove ${host.hostname}`" @click="remove(host)">
            <Icon name="trash" /> Remove
          </button>
        </div>
        <HostVerification :hostname="host.hostname" :verification="host.verification" :can-manage="canManage" :busy="verifying === host.id" @verify="verify(host)" />
      </template>
    </AsyncList>
    <PluginSlot v-if="spaces.current" id="space.domains" :props="{ space: spaces.current }" />
  </Panel>
</template>
