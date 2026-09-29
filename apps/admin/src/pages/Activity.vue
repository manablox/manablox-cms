<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import Pager from '@manablox/admin-sdk/components/ui/Pager.vue';
import Panel from '@manablox/admin-sdk/components/ui/Panel.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import { useSort } from '@manablox/admin-sdk/composables/useSort';
import { plural } from '@manablox/admin-sdk/lib/format';
import { toast } from '@manablox/admin-sdk/lib/toast';
import { runWrite } from '@manablox/admin-sdk/lib/write';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import PluginSlot from '~/components/PluginSlot';
import AuditFilters from '~/features/audit/components/AuditFilters.vue';
import AuditTable from '~/features/audit/components/AuditTable.vue';
import {
  type AuditFilterForm,
  type AuditSortState,
  emptyFilter,
  hasFilter,
  PAGE_SIZE,
} from '~/features/audit/model';
import {
  type AuditVerification,
  audit as auditActions,
  useAuditCatalog,
  useAuditEntries,
} from '~/features/audit/queries';

/** The activity log, newest first. Superadmins can view instance-wide and verify the chain. */
const spaces = useSpaceStore();
const session = useSessionStore();

type Scope = 'space' | 'instance' | 'instance-only';
const scope = ref<Scope>('space');
const SCOPES: Array<{ value: Scope; label: string; hint: string }> = [
  { value: 'space', label: 'This space', hint: 'What happened here' },
  { value: 'instance', label: 'Everything', hint: 'Every space and the instance' },
  { value: 'instance-only', label: 'Instance only', hint: 'Accounts, keys, spaces' },
];

// The search box debounces itself.
const filter = ref<AuditFilterForm>(emptyFilter());

// Time starts newest first, text columns A to Z.
const { sort, toggle: toggleSort } = useSort<AuditSortState['by']>(
  { by: 'at', direction: 'desc' },
  (by) => (by === 'at' ? 'desc' : 'asc'),
);

const params = computed(() => ({ filter: filter.value, sort: sort.value }));
const { data, isPending, isFetching, error, refetch, page, total, capped } = useAuditEntries(
  params,
  scope,
);
const { data: catalog } = useAuditCatalog();

const spaceName = (spaceId: string | null) =>
  spaceId ? (spaces.spaces.find((space) => space.id === spaceId)?.name ?? spaceId) : 'Instance';

const verifying = ref(false);
const verification = ref<AuditVerification | null>(null);

async function verify() {
  verification.value = null;
  const done = await runWrite(
    async () => {
      verification.value = await auditActions.verify();
    },
    { busy: verifying },
  );
  const result = verification.value as AuditVerification | null;
  if (!done || !result) return;
  if (result.ok) {
    toast.success(`Chain intact: ${plural(result.checked, 'entry', 'entries')} verified`);
  } else {
    toast.error(`Chain broken at entry #${result.brokenAt?.seq}`);
  }
}
</script>

<template>
  <div class="mb-page-wide">
    <PageHeader
      title="Activity"
      description="Everything done in this space, newest first: who did it, when, and what changed. Entries are written once and never edited."
    >
      <SegmentedControl
        v-if="session.isSuperadmin"
        v-model="scope"
        :options="SCOPES"
        aria-label="Scope"
      />
      <button v-if="session.isSuperadmin" class="mb-btn-outline" :disabled="verifying" @click="verify">
        <Icon name="shield" class="mb-icon" /> {{ verifying ? 'Verifying...' : 'Verify chain' }}
      </button>
    </PageHeader>

    <div v-if="verification" class="mb-callout mb-4 flex items-center gap-2 text-xs" :class="verification.ok ? '' : 'mb-text-danger'">
      <Icon :name="verification.ok ? 'ok' : 'fail'" class="mb-icon shrink-0" />
      <template v-if="verification.ok">Every one of {{ plural(verification.checked, 'entry', 'entries') }} hashes to what it claims, and each links to the one before.</template>
      <template v-else>The chain breaks at entry #{{ verification.brokenAt?.seq }} ({{ verification.brokenAt?.reason === 'hash' ? 'its content no longer matches its hash' : 'it does not link to its predecessor' }}). Something was changed or removed outside the application.</template>
    </div>

    <AuditFilters v-model="filter" :catalog="catalog" class="mb-4" />
    <PluginSlot id="audit.entities" />

    <Panel title="Entries" :count="capped ? `${total}+` : total">
      <template #actions>
        <div class="flex flex-wrap items-center gap-3">
          <Loader v-if="isFetching && !isPending" inline label="Refreshing..." class="text-xs" />
          <Pager v-model:page="page" :total="total" :capped="capped" :page-size="PAGE_SIZE" />
        </div>
      </template>

      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="data?.items"
        skeleton="table"
        :rows="8"
        empty-icon="activity"
        :empty-title="hasFilter(filter) ? 'Nothing matches' : 'Nothing yet'"
        :empty-description="hasFilter(filter) ? 'Widen the filter, or clear it.' : 'Entries appear here as soon as something is created, edited, published or deleted.'"
      >
        <template #default="{ items }">
          <AuditTable
            :items="items ?? []"
            :sort="sort"
            :show-space="scope !== 'space'"
            :space-name="spaceName"
            @sort="toggleSort"
          />
        </template>
      </AsyncList>
    </Panel>
  </div>
</template>
