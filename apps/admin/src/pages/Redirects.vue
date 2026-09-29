<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import { relativeTime } from '@manablox/admin-sdk/lib/format';
import { requireSpace, useCan } from '@manablox/admin-sdk/lib/space';
import { confirmAndRun } from '@manablox/admin-sdk/lib/write';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { RedirectSource } from '@manablox/core';
import { computed, ref } from 'vue';
import RedirectDialog from '~/features/redirects/components/RedirectDialog.vue';
import {
  REDIRECT_PAGE_SIZE,
  type Redirect,
  redirects,
  useRedirects,
} from '~/features/redirects/queries';

/** Old addresses of the space's website and where they lead. */
const spaces = useSpaceStore();
const canRead = useCan('redirect:read');
const canWrite = useCan('redirect:write');

const search = ref('');
const source = ref<RedirectSource | 'all'>('all');
const locale = ref<string | null>(null);
const { data, isPending, error, refetch, page, total } = useRedirects({
  search,
  source: () => (source.value === 'all' ? null : source.value),
  locale,
});

const SOURCES = [
  { value: 'all' as const, label: 'All' },
  { value: 'manual' as const, label: 'Manual' },
  { value: 'auto' as const, label: 'Automatic' },
];
const localeOptions = computed(() => [
  { value: null, label: 'Every language' },
  ...(spaces.current?.locales ?? []).map((code) => ({ value: code, label: code })),
]);
const multilingual = computed(() => (spaces.current?.locales.length ?? 1) > 1);

const rows = computed(() => data.value?.items ?? []);

const editing = ref<Redirect | null>(null);
const creating = ref(false);

function remove(row: Redirect) {
  return confirmAndRun(
    {
      title: `Remove the redirect from ${row.fromPath}?`,
      message: 'Visitors on the old address get the "page not found" page instead.',
      confirmLabel: 'Remove redirect',
      danger: true,
    },
    () => redirects.delete(requireSpace(), row.id),
    { success: `Removed the redirect from ${row.fromPath}` },
  );
}
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Redirects"
      description="Where old addresses lead. When a published page gets a new address, a permanent redirect from the old one is added for you. Frontends read them from the delivery API."
    >
      <button v-if="canWrite" type="button" class="mb-btn-primary" @click="creating = true">
        <Icon name="plus" /> Add redirect
      </button>
    </PageHeader>

    <EmptyState v-if="!canRead" icon="lock" title="No access to redirects" description="Someone who manages this space's roles can give you the right to see redirects." />

    <section v-else class="mb-card space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <SearchField v-model="search" label="Search redirects" size="sm" placeholder="Search paths..." class="min-w-48 flex-1" />
        <SegmentedControl v-model="source" :options="SOURCES" aria-label="Made by" />
        <Select v-if="multilingual" v-model="locale" :options="localeOptions" variant="sm" aria-label="Language" class="w-40" />
      </div>

      <AsyncList
        :pending="isPending"
        :error="error"
        :retry="refetch"
        :items="rows"
        v-model:page="page"
        :total="total"
        :page-size="REDIRECT_PAGE_SIZE"
        empty-icon="link"
        :empty-title="search || source !== 'all' || locale ? 'No matching redirects' : 'No redirects yet'"
        :empty-description="canWrite ? 'Add one for an address that moved, or wait for a page to get a new one.' : undefined"
        item-class="py-3"
      >
        <template #item="{ item: row }">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-center gap-2 font-mono text-sm">
                <span class="truncate">{{ row.fromPath }}</span>
                <Icon name="chevron" class="mb-icon-sm shrink-0 text-surface-400" />
                <span v-if="row.toPath" class="truncate">{{ row.toPath }}</span>
                <span v-else class="flex min-w-0 items-center gap-1 font-sans text-surface-600 dark:text-surface-300">
                  <Icon name="doc" class="mb-icon-sm shrink-0" />
                  <span v-if="row.toTitle" class="truncate" :title="`The current address of ${row.toTitle}`">{{ row.toTitle }}</span>
                  <span v-else class="text-warn-700 dark:text-warn-300">a document that no longer exists</span>
                </span>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-2 mb-meta">
                <span class="mb-badge">{{ row.status }}</span>
                <span :class="row.source === 'auto' ? 'mb-badge-brand' : 'mb-badge'">{{ row.source === 'auto' ? 'automatic' : 'manual' }}</span>
                <span v-if="multilingual" class="mb-badge">{{ row.locale ?? 'every language' }}</span>
                <span>changed {{ relativeTime(row.updatedAt) }}</span>
              </div>
            </div>
            <div v-if="canWrite" class="flex flex-wrap items-center gap-2">
              <button type="button" class="mb-btn-ghost" :aria-label="`Edit the redirect from ${row.fromPath}`" @click="editing = row">Edit</button>
              <button type="button" class="mb-btn-ghost-danger" :aria-label="`Remove the redirect from ${row.fromPath}`" @click="remove(row)">
                <Icon name="trash" /> Remove
              </button>
            </div>
          </div>
        </template>
      </AsyncList>
    </section>

    <RedirectDialog v-if="creating && spaces.currentId" :redirect="null" :space-id="spaces.currentId" @close="creating = false" />
    <RedirectDialog v-if="editing && spaces.currentId" :redirect="editing" :space-id="spaces.currentId" @close="editing = null" />
  </div>
</template>
