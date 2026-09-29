<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SidePanel from '@manablox/admin-sdk/components/layout/SidePanel.vue';
import AsyncList from '@manablox/admin-sdk/components/ui/AsyncList.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import { usePanel } from '@manablox/admin-sdk/composables/usePanel';
import ContentTreeSearchList from '@manablox/admin-sdk/features/content/components/ContentTreeSearchList.vue';
import { searchRows } from '@manablox/admin-sdk/features/content/model/tree-search';
import { useContentAncestors, useTreeSearch } from '@manablox/admin-sdk/features/content/queries';
import { invalidate } from '@manablox/admin-sdk/lib/invalidate';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ContentTree from '~/features/content/components/ContentTree.vue';
import FolderDialog from '~/features/content/components/FolderDialog.vue';
import { expansion } from '~/features/content/model/tree-expansion';

/** Content tree side column, mounted by `Shell` on `/content` routes. */
const spaces = useSpaceStore();
const session = useSessionStore();
const route = useRoute();
const showTypeMenu = ref(false);

// Expansion state is remembered per space and locale.
watch(
  () => [spaces.currentId, spaces.locale] as const,
  ([spaceId, locale]) => expansion.scope(spaceId, locale),
  { immediate: true },
);

/** Expand the open document's ancestors so its row loads. */
const openId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null));
const { data: ancestors } = useContentAncestors(openId);
watch(ancestors, (ids) => expansion.expand(ids ?? []), { immediate: true });

/** A term swaps the tree for its matches, drawn in place with their ancestors. */
const search = ref('');
const searching = computed(() => search.value.trim().length > 0);
const found = useTreeSearch(() => spaces.locale, search);
const foundRows = computed(() => searchRows(found.data.value?.nodes ?? []));
const hidden = computed(() => {
  const shown = foundRows.value.filter((row) => row.match).length;
  return Math.max(0, (found.data.value?.total ?? 0) - shown);
});

function refetch(): void {
  invalidate.content(spaces.currentId);
}

/** Write permission may be granted per type. */
const creatable = computed(() =>
  spaces.creatableKinds.filter(
    (type) => type.isVisibleInTree && session.can('content:write', spaces.currentId, type.id),
  ),
);
const panel = usePanel('tree');

/** Parent for a new folder: `undefined` is closed, `null` is the root. */
const folderParent = ref<string | null | undefined>(undefined);

function askFolder(parentId: string | null) {
  showTypeMenu.value = false;
  folderParent.value = parentId;
}
</script>

<template>
  <SidePanel label="Tree" hide-label resize="tree" @hide="panel.toggle()">
    <template #action>
      <DropdownMenu v-if="session.can('content:write', spaces.currentId)" v-model:open="showTypeMenu">
        <template #trigger>
          <button class="mb-btn-ghost mb-btn-icon mb-btn-sm -my-1" aria-label="New document" title="New document">
            <Icon name="plus" class="mb-icon" />
          </button>
        </template>
        <button
          v-if="spaces.folderType"
          type="button"
          class="mb-menu-item"
          @click="askFolder(null)"
        >
          <Icon name="folder-plus" class="mb-icon-sm" />
          New folder
        </button>
        <EmptyState v-if="!creatable.length" bare title="No content types yet." />
        <RouterLink v-for="type in creatable" :key="type.id" :to="`/content/new/${type.id}`" class="mb-menu-item">
          <Icon :name="typeIcon(type)" class="mb-icon-sm shrink-0 text-surface-500" />
          {{ type.label }}
        </RouterLink>
      </DropdownMenu>
    </template>

    <template #filter>
      <SearchField v-model="search" label="Search the tree" size="sm" class="mx-3 mb-2" placeholder="Search..." />
    </template>

    <AsyncList
      v-if="searching"
      :pending="found.isPending.value"
      :error="found.error.value"
      :retry="found.refetch"
      :items="foundRows"
      :rows="4"
      empty="bare"
      empty-title="No matching documents"
    >
      <ContentTreeSearchList :rows="foundRows" :term="search" :to="(doc) => `/content/${doc.id}`" :active-id="openId" />
      <p v-if="hidden" class="px-2 py-1 text-2xs text-surface-500">{{ hidden }} more; narrow the search.</p>
    </AsyncList>
    <ContentTree v-else :parent-id="null" @changed="refetch()" @folder="askFolder" />

    <FolderDialog
      v-if="folderParent !== undefined"
      :parent-id="folderParent"
      @created="refetch()"
      @close="folderParent = undefined"
    />
  </SidePanel>
</template>
