<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import PageHeader from '@manablox/admin-sdk/components/PageHeader.vue';
import TagFilter from '@manablox/admin-sdk/components/TagFilter.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import { useShortcuts } from '@manablox/admin-sdk/composables/useShortcuts';
import { useContentSearch } from '@manablox/admin-sdk/features/content/queries';
import { useContentTags } from '@manablox/admin-sdk/features/tags/queries';
import { shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';

const spaces = useSpaceStore();
const session = useSessionStore();
const search = ref('');
const tagIds = ref<string[]>([]);
const showTypeMenu = ref(false);

const canWrite = useCan('content:write');
const {
  data: results,
  isPending: searching,
  error,
  refetch,
} = useContentSearch(() => spaces.locale, search, tagIds);

/** The search box and the tag filter each narrow the list on their own. */
const filtering = computed(() => search.value.length > 1 || tagIds.value.length > 0);

const nothingFound = computed(() =>
  search.value.length > 1
    ? `Nothing matches "${search.value}".`
    : 'No document carries those tags.',
);

const { data: tagsByContent } = useContentTags(() =>
  (results.value?.items ?? []).map((item) => item.id),
);

/** Types the caller may create documents of. */
const creatable = computed(() =>
  spaces.creatableKinds.filter(
    (type) => type.isVisibleInTree && session.can('content:write', spaces.currentId, type.id),
  ),
);

// `n` opens the type menu.
useShortcuts(() => [
  {
    keys: 'n',
    label: 'New document',
    enabled: () => creatable.value.length > 0,
    run: () => {
      showTypeMenu.value = true;
    },
  },
]);
</script>

<template>
  <div class="mb-page-narrow">
    <PageHeader title="Content" description="Every document in this space, in the language chosen above.">
      <DropdownMenu v-if="canWrite" v-model:open="showTypeMenu">
        <template #trigger>
          <button class="mb-btn-primary" :title="shortcutHint('n', 'New document')"><Icon name="plus" /> New</button>
        </template>
        <EmptyState v-if="!creatable.length" bare title="No content types yet." />
        <RouterLink v-for="type in creatable" :key="type.id" :to="`/content/new/${type.id}`" class="mb-menu-item">
          <Icon :name="typeIcon(type)" class="mb-icon-sm shrink-0 text-surface-500" />
          {{ type.label }}
        </RouterLink>
      </DropdownMenu>
    </PageHeader>

    <div class="flex flex-wrap items-center gap-3">
      <SearchField
        v-model="search"
        label="Search documents"
        size="lg"
        shortcut="Search documents"
        class="min-w-0 flex-1"
        placeholder="Search by title, text or tag..."
      />
      <TagFilter v-model="tagIds" />
    </div>

    <div v-if="filtering" class="mb-card mt-4">
      <AsyncList
        :pending="searching"
        :error="error"
        :retry="refetch"
        :items="results?.items"
        empty="bare"
        :empty-title="nothingFound"
      >
        <template #item="{ item }">
          <RouterLink :to="`/content/${item.id}`" class="group -mx-2 flex items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-100 dark:hover:bg-surface-800">
            <Icon :name="typeIcon(spaces.typeById(item.typeId))" class="mb-icon shrink-0 text-surface-400" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-200">
              {{ item.title || 'Untitled' }}
            </span>
            <span v-for="tag in tagsByContent?.[item.id] ?? []" :key="tag.id" class="mb-badge shrink-0">
              {{ tag.name }}
            </span>
            <span class="truncate font-mono mb-meta">{{ item.permalink }}</span>
          </RouterLink>
        </template>
      </AsyncList>
    </div>

    <!-- The tree is the shell's side column; this page is search. -->
    <EmptyState
      v-else
      class="mt-8"
      icon="tree"
      title="Pick a document from the tree"
      description="Drag rows to move them, star one to make it the home page, or search above."
    />
  </div>
</template>
