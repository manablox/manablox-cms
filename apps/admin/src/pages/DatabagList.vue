<script setup lang="ts">
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import NewButton from '@manablox/admin-sdk/components/ui/NewButton.vue';
import SectionIntro from '@manablox/admin-sdk/components/ui/SectionIntro.vue';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { useDatabagCounts } from '~/features/databags/queries';

/** The `/databags` landing: pick a databag to see its entries. The shell's side column lists them too. */
const spaces = useSpaceStore();
const canDefine = useCan('contentType:write');

const { data: counts } = useDatabagCounts(
  () => spaces.locale,
  () => spaces.dataKinds.map((type) => type.id),
);
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader
      title="Databags"
      description="Structured records that live outside the content tree: products, team members, FAQs, anything a site reads as a list. Pick a databag to browse its entries."
    >
      <NewButton label="New databag type" to="/databag-types/new" :enabled="canDefine" />
    </PageHeader>

    <EmptyState
      v-if="!spaces.dataKinds.length"
      icon="database"
      title="No databags yet"
      :description="
        canDefine
          ? 'Define a databag type first: its fields become the columns of every entry.'
          : 'Someone who can edit content types defines them.'
      "
    >
      <RouterLink v-if="canDefine" to="/databag-types/new" class="mb-btn-primary">
        Define a databag type
      </RouterLink>
    </EmptyState>

    <ul v-else class="grid gap-3 sm:grid-cols-2" aria-label="Databags">
      <li v-for="type in spaces.dataKinds" :key="type.id">
        <RouterLink
          :to="`/databags/${type.id}`"
          class="mb-card block h-full transition hover:border-brand-300 dark:hover:border-brand-700"
          :title="`Entries in ${spaces.locale.toUpperCase()}: ${counts?.[type.id] ?? '-'}`"
        >
          <SectionIntro :icon="typeIcon(type)" :title="type.label" :count="counts?.[type.id] ?? '-'">
            <span class="block truncate font-mono text-2xs">{{ type.name }}</span>
            <span v-if="type.description" class="mt-1 line-clamp-2 block">{{ type.description }}</span>
          </SectionIntro>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
