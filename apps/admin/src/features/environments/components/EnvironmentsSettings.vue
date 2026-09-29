<script setup lang="ts">
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import {
  type EnvironmentRow,
  environmentRows,
  type PromoteOutcome,
  promoteOutcome,
} from '@manablox/admin-sdk/features/environments/model';
import {
  environments as actions,
  type Environment,
  type PromoteResult,
} from '@manablox/admin-sdk/features/environments/queries';
import { useEnvironment } from '@manablox/admin-sdk/features/environments/useEnvironment';
import { messageForKey } from '@manablox/admin-sdk/lib/messages';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import EnvironmentCreateDialog from './EnvironmentCreateDialog.vue';
import EnvironmentPromoteDialog from './EnvironmentPromoteDialog.vue';
import EnvironmentPromoteResult from './EnvironmentPromoteResult.vue';

/** Settings -> Environments: the space's production and staging copies. */
const route = useRoute();
const router = useRouter();
const { environments: list, machineName, switchTo } = useEnvironment();
const canManage = useCan('environment:manage');

const rows = computed(() => (list.data.value ? environmentRows(list.data.value) : undefined));
const byName = (name: string): Environment | null =>
  list.data.value?.find((environment) => environment.machineName === name) ?? null;

const creating = ref(false);
const promoting = ref<Environment | null>(null);
const outcome = ref<PromoteOutcome | null>(null);

// `?promote=` opens the promote dialog, e.g. from the staging bar.
watch(
  [() => route.query.promote, () => list.data.value],
  ([asked]) => {
    if (typeof asked !== 'string' || !list.data.value) return;
    const target = byName(asked);
    if (target && target.kind === 'staging' && canManage.value) promoting.value = target;
    const { promote: _promote, ...query } = route.query;
    void router.replace({ query });
  },
  { immediate: true },
);

function promoted(result: PromoteResult) {
  const name = promoting.value?.name ?? result.environment;
  outcome.value = promoteOutcome(result, name, (key) => messageForKey(key));
}

function remove(row: EnvironmentRow) {
  return confirmAndRun(
    {
      title: `Delete ${row.name}?`,
      message:
        'Everything in it is deleted: its content types, content, menus, domains, API hosts and what plugins keep for it. Production is not touched.',
      confirmLabel: 'Delete environment',
      danger: true,
      requireText: row.machineName,
    },
    () => actions.remove(requireSpace(), row.machineName),
    { success: `Deleted ${row.name}` },
  );
}
</script>

<template>
  <Panel
    title="Environments"
    description="Staging copies of this space to change content types and content without touching production, then promote the changes in one step."
    size="lg"
    :card="false"
  >
    <template v-if="canManage" #actions>
      <FeatureGate feature="environments" label="New environment" trigger-class="mb-btn-primary shrink-0" align="end">
        <button type="button" class="mb-btn-primary shrink-0" @click="creating = true">
          <Icon name="plus" /> New environment
        </button>
      </FeatureGate>
    </template>

    <AsyncList
      :pending="list.isPending.value"
      :error="list.error.value"
      :retry="list.refetch"
      :items="rows"
      empty-icon="layers"
      empty-title="No environments"
      empty="block"
      list-class="text-sm"
      item-class="flex flex-wrap items-center gap-2 py-2.5"
    >
      <template #item="{ item: row }">
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">{{ row.name }}</span>
            <code class="font-mono mb-meta">{{ row.machineName }}</code>
            <span :class="row.production ? 'mb-badge-ok' : 'mb-badge-warn'">{{ row.kind }}</span>
            <span v-if="row.machineName === machineName" class="mb-badge">open</span>
          </span>
          <span class="block truncate mb-meta">
            <template v-if="row.origin">{{ row.origin }} - </template>created {{ row.created }}
          </span>
        </span>
        <button v-if="row.machineName !== machineName" type="button" class="mb-btn-ghost mb-btn-sm" :aria-label="`Open ${row.name}`" @click="switchTo(row.machineName)">
          <Icon name="arrow-right" /> Open
        </button>
        <template v-if="canManage && !row.production">
          <button type="button" class="mb-btn-ghost mb-btn-sm" :aria-label="`Promote ${row.name}`" @click="promoting = byName(row.machineName)">
            <Icon name="upload" /> Promote
          </button>
          <button type="button" class="mb-btn-ghost-danger mb-btn-sm" :aria-label="`Delete ${row.name}`" @click="remove(row)">
            <Icon name="trash" /> Delete
          </button>
        </template>
      </template>
    </AsyncList>
    <p class="mb-hint mt-3">
      Members, roles, assets, tags, credentials and what plugins keep for the whole space are shared. Each environment has its own domains and API hosts.
    </p>

    <EnvironmentCreateDialog v-if="creating && list.data.value" :environments="list.data.value" @close="creating = false" />
    <EnvironmentPromoteDialog v-if="promoting" :environment="promoting" @done="promoted" @close="promoting = null" />
    <EnvironmentPromoteResult v-if="outcome" :outcome="outcome" @close="outcome = null" />
  </Panel>
</template>
