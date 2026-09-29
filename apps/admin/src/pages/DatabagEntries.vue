<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import Pager from '@manablox/admin-sdk/components/ui/Pager.vue';
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import { useBreadcrumb } from '@manablox/admin-sdk/composables/useBreadcrumb';
import { useSort } from '@manablox/admin-sdk/composables/useSort';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import DatabagTable from '~/features/databags/components/DatabagTable.vue';
import {
  DATABAG_PAGE_SIZE,
  type DatabagSort,
  useDatabagEntries,
} from '~/features/databags/queries';

/** One databag's entries in the current locale: searchable, sortable and paged. */
const spaces = useSpaceStore();
const route = useRoute();

const typeId = computed(() => (typeof route.params.typeId === 'string' ? route.params.typeId : ''));
const type = computed(() => {
  const found = spaces.typeById(typeId.value);
  return found?.kind === 'data' ? found : null;
});

const canWrite = useCan('content:write', typeId);
const canEditFields = useCan('contentType:write');

const search = ref('');
const { sort, toggle: toggleSort } = useSort<DatabagSort['by']>(
  { by: 'updatedAt', direction: 'desc' },
  (by) => (by === 'title' ? 'asc' : 'desc'),
);

// A new databag starts with an empty search.
watch(typeId, () => {
  search.value = '';
});

const term = computed(() => search.value.trim());
const { data, isPending, isFetching, error, refetch, page, total } = useDatabagEntries(
  typeId,
  () => spaces.locale,
  () => ({ search: term.value, sort: sort.value }),
);

const emptyDescription = computed(() => {
  if (term.value) return `No entry matches '${term.value}'.`;
  return canWrite.value ? 'Add the first one.' : 'Someone with content rights can add them.';
});

useBreadcrumb(() => type.value?.label ?? null);
</script>

<template>
  <div class="mb-page">
    <!-- Single root; a top-level comment would make a fragment the transition cannot animate. -->
    <PageState
      :not-found="!type"
      not-found-title="Databag not found"
      not-found-icon="database"
      back-to="/databags"
      back-label="All databags"
    >
      <template v-if="type">
        <PageHeader eyebrow="Databag" :title="type.label" :description="type.description ?? ''">
          <RouterLink
            v-if="canEditFields"
            :to="`/databag-types/${type.id}`"
            class="mb-btn-ghost"
            title="Edit this databag's fields"
          >
            <Icon name="settings" /> Fields
          </RouterLink>
          <NewButton label="New entry" :to="`/databags/${type.id}/new`" :enabled="canWrite" />
        </PageHeader>

        <section class="mb-card">
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <SearchField
              v-model="search"
              label="Search entries"
              shortcut="Search entries"
              class="min-w-0 flex-1 basis-60"
              placeholder="Search by title, text or tag..."
            />
            <Loader v-if="isFetching && !isPending" inline label="Refreshing..." class="text-xs" />
            <Pager v-model:page="page" :total="total" :page-size="DATABAG_PAGE_SIZE" always />
          </div>

          <DatabagTable
            :type="type"
            :items="data?.items"
            :sort="sort"
            :pending="isPending"
            :error="error"
            :retry="refetch"
            :empty-title="term ? 'Nothing matches' : 'No entries yet'"
            :empty-description="emptyDescription"
            @sort="toggleSort"
          >
            <template v-if="!term && canWrite" #empty-actions>
              <RouterLink :to="`/databags/${type.id}/new`" class="mb-btn-primary">New entry</RouterLink>
            </template>
          </DatabagTable>
        </section>
      </template>
    </PageState>
  </div>
</template>
