<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SidePanel from '@manablox/admin-sdk/components/layout/SidePanel.vue';
import DropdownMenu from '@manablox/admin-sdk/components/ui/DropdownMenu.vue';
import EmptyState from '@manablox/admin-sdk/components/ui/EmptyState.vue';
import NavList from '@manablox/admin-sdk/components/ui/NavList.vue';
import NavListItem from '@manablox/admin-sdk/components/ui/NavListItem.vue';
import SearchField from '@manablox/admin-sdk/components/ui/SearchField.vue';
import StatusBadge from '@manablox/admin-sdk/components/ui/StatusBadge.vue';
import Tabs from '@manablox/admin-sdk/components/ui/Tabs.vue';
import { usePanel } from '@manablox/admin-sdk/composables/usePanel';
import type { ContentTypeSummary } from '@manablox/admin-sdk/features/content-types/queries';
import { useCan } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

/** Content type side column, mounted by `Shell` on `/types` routes. */
const spaces = useSpaceStore();
const route = useRoute();

const search = ref('');
const showNew = ref(false);
const canWrite = useCan('contentType:write');

function matches(type: ContentTypeSummary): boolean {
  const term = search.value.trim().toLowerCase();
  if (!term) return true;
  return type.label.toLowerCase().includes(term) || type.name.toLowerCase().includes(term);
}

type Kind = 'content' | 'block';
const kind = ref<Kind>('content');

const listed = computed(() =>
  (kind.value === 'block' ? spaces.blockKinds : spaces.creatableKinds).filter(matches),
);

const tabs = computed(() => [
  { id: 'content' as const, label: 'Documents', count: spaces.creatableKinds.length },
  { id: 'block' as const, label: 'Blocks', count: spaces.blockKinds.length },
]);

/** Not `contentTypes.length`: the system folder and template types are always present. */
const hasTypes = computed(() => spaces.creatableKinds.length + spaces.blockKinds.length > 0);

const isActive = (id: string) => route.params.id === id;
const panel = usePanel('types');

// Switch to the tab holding the routed type.
watch(
  () => [route.params.id, spaces.blockKinds] as const,
  ([id, blocks]) => {
    if (typeof id === 'string' && blocks.some((type) => type.id === id)) kind.value = 'block';
  },
  { immediate: true },
);
</script>

<template>
  <SidePanel label="Types" to="/types" resize="types" @hide="panel.toggle()">
    <template #action>
      <DropdownMenu v-if="canWrite" v-model:open="showNew" class="w-60">
        <template #trigger>
          <button class="mb-btn-ghost mb-btn-icon mb-btn-sm -my-1" aria-label="New type" title="New type">
            <Icon name="plus" class="mb-icon" />
          </button>
        </template>
        <div>
          <RouterLink to="/types/new" class="mb-menu-item flex items-start gap-2.5">
            <Icon name="doc" class="mt-0.5 mb-icon shrink-0 text-brand-500" />
            <span>
              <span class="block font-medium">Document type</span>
              <span class="block mb-meta">Lives in the tree, can have a URL</span>
            </span>
          </RouterLink>
          <RouterLink to="/types/new?kind=block" class="mb-menu-item flex items-start gap-2.5">
            <Icon name="blocks" class="mt-0.5 mb-icon shrink-0 text-ochre-500" />
            <span>
              <span class="block font-medium">Block type</span>
              <span class="block mb-meta">Stacked inside a block field</span>
            </span>
          </RouterLink>
        </div>
      </DropdownMenu>
    </template>

    <template #filter>
      <!-- Equal halves so both fit at the narrowest width. -->
      <Tabs
        v-model="kind"
        :tabs="tabs"
        aria-label="Kind of type"
        class="mx-3 mb-2 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:justify-center [&>button]:px-2"
      />
      <SearchField
        v-if="spaces.contentTypes.length > 8"
        v-model="search"
        label="Filter types"
        size="sm"
        :debounce="0"
        class="mx-3 mb-2"
        placeholder="Filter..."
      />
    </template>

    <EmptyState v-if="!hasTypes" compact icon="blocks" title="No types yet" description="Use + to define one." />

    <template v-else>
      <p v-if="!listed.length" class="px-2 py-1 text-xs text-surface-400">
        {{ search.trim() ? 'No match' : 'None yet' }}
      </p>
      <NavList v-else :aria-label="kind === 'block' ? 'Block types' : 'Document types'">
        <NavListItem
          v-for="type in listed"
          :key="type.id"
          :to="`/types/${type.id}`"
          :active="isActive(type.id)"
          :icon="typeIcon(type)"
          compact
        >
          <span class="block truncate text-sm font-medium">{{ type.label }}</span>
          <span class="block truncate font-mono text-2xs text-surface-500">{{ type.name }}</span>
          <template #trailing>
            <StatusBadge v-if="type.source === 'code'" status="code" class="shrink-0" title="Declared in code; read-only here" />
            <span v-else class="shrink-0 font-mono text-2xs text-surface-400 tabular-nums" :title="`${type.fields.length} fields`">{{ type.fields.length }}</span>
          </template>
        </NavListItem>
      </NavList>
    </template>
  </SidePanel>
</template>
