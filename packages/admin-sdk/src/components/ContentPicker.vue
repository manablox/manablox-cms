<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core';
import { computed, ref } from 'vue';
import ContentTreeBrowser from '../features/content/components/ContentTreeBrowser.vue';
import ContentTreeSearchList from '../features/content/components/ContentTreeSearchList.vue';
import { searchRows } from '../features/content/model/tree-search';
import { useContentPicker, useTreeSearch } from '../features/content/queries';
import type { ContentListItem } from '../lib/api-types';
import { toggleInSet } from '../lib/collections';
import { typeIcon } from '../lib/type-icon';
import { useSpaceStore } from '../stores/space';
import Icon from './Icon.vue';
import AsyncList from './ui/AsyncList.vue';
import Dialog from './ui/Dialog.vue';
import Popover from './ui/Popover.vue';
import SearchField from './ui/SearchField.vue';

/**
 * Document picker, as a `popover`, `dialog` or `inline`. Tree types are browsed and searched
 * in the content tree; other types in a flat search list. `filter` narrows beyond types.
 */
type Row = Pick<
  ContentListItem,
  'id' | 'localizationId' | 'typeId' | 'title' | 'permalink' | 'status'
>;

const props = withDefaults(
  defineProps<{
    variant?: 'popover' | 'dialog' | 'inline';
    /** Only documents of these types; empty means every type. */
    typeIds?: readonly string[];
    filter?: ((row: Row) => boolean) | undefined;
    /** The dialog's title, or the popover trigger's label. */
    label?: string;
    triggerClass?: string;
    triggerIcon?: string | undefined;
    placeholder?: string;
    /** Marked with a check. */
    selected?: readonly string[];
    /** Stays open after a pick, to pick several. */
    keepOpen?: boolean;
    /** Another space or locale than the current one. */
    spaceId?: string | null | undefined;
    locale?: string | undefined;
  }>(),
  {
    variant: 'popover',
    typeIds: () => [],
    label: 'Pick a document',
    triggerClass: 'mb-btn-outline',
    placeholder: 'Search documents...',
    selected: () => [],
    keepOpen: false,
  },
);
const emit = defineEmits<{ pick: [row: Row]; close: [] }>();

// `height` only feeds the slot; inherited, it would fall onto `AsyncList`'s fragment root.
const [DefineResults, Results] = createReusableTemplate<{ height: string }>({
  inheritAttrs: false,
});

const spaces = useSpaceStore();
const open = ref(false);
const search = ref('');
const active = computed(() => props.variant !== 'popover' || open.value);
const locale = computed(() => props.locale ?? spaces.locale);
const spaceRef = props.spaceId === undefined ? undefined : () => props.spaceId ?? null;

/** Documents in the tree are picked from it; databag entries and the like from a list. */
const inTree = computed(
  () =>
    !props.typeIds.length ||
    props.typeIds.every((id) => spaces.typeById(id)?.isVisibleInTree === true),
);
const searching = computed(() => search.value.trim().length > 0);

const list = useContentPicker(
  locale,
  search,
  () => props.typeIds,
  () => active.value && !inTree.value,
  spaceRef,
);
const listRows = computed(() => {
  const items = list.data.value?.items ?? [];
  return props.filter ? items.filter(props.filter) : items;
});

const found = useTreeSearch(
  locale,
  () => (active.value && inTree.value ? search.value : ''),
  () => props.typeIds,
  spaceRef,
);
const foundRows = computed(() => searchRows(found.data.value?.nodes ?? []));

/** Open rows of the browsed tree, for this picker only. */
const expanded = ref<ReadonlySet<string>>(new Set());
const toggle = (id: string) => {
  expanded.value = toggleInSet(expanded.value, id);
};

/** Folders only when asked for by type; they have no page of their own. */
function pickable(row: Row): boolean {
  const typed = props.typeIds.length
    ? props.typeIds.includes(row.typeId)
    : !spaces.isFolder(row.typeId);
  return typed && (props.filter ? props.filter(row) : true);
}

function where(row: Row): string {
  return row.permalink != null ? `/${row.permalink}` : (spaces.typeById(row.typeId)?.label ?? '');
}

function pick(row: Row) {
  emit('pick', row);
  if (props.keepOpen) return;
  open.value = false;
  search.value = '';
}
</script>

<template>
  <DefineResults v-slot="{ height }">
    <div class="overflow-auto" :class="height">
      <AsyncList
        v-if="inTree && searching"
        :pending="found.isPending.value"
        :error="found.error.value"
        :retry="found.refetch"
        :items="foundRows"
        :rows="3"
        empty="bare"
        empty-title="No matching documents"
      >
        <ContentTreeSearchList :rows="foundRows" :term="search" :pickable="pickable" :selected="selected" @pick="pick" />
        <p v-if="(found.data.value?.total ?? 0) > foundRows.filter((row) => row.match).length" class="px-2 py-1 text-2xs text-surface-500">
          More match; type a little more.
        </p>
      </AsyncList>

      <ContentTreeBrowser
        v-else-if="inTree"
        :parent-id="null"
        :locale="locale"
        :space-id="spaceId"
        :expanded="expanded"
        :pickable="pickable"
        :selected="selected"
        @pick="pick"
        @toggle="toggle"
      />

      <AsyncList
        v-else
        :pending="list.isPending.value"
        :error="list.error.value"
        :retry="list.refetch"
        :items="listRows"
        :rows="3"
        empty="bare"
        empty-title="No matching documents"
      >
        <ul>
          <li v-for="row in listRows" :key="row.id">
            <button type="button" class="mb-menu-item flex w-full items-center gap-2 text-left" @click="pick(row)">
              <Icon :name="typeIcon(spaces.typeById(row.typeId))" class="mb-icon-sm shrink-0 text-surface-400" />
              <span class="min-w-0 flex-1">
                <span class="block truncate">{{ row.title }}</span>
                <span class="block truncate font-mono text-2xs text-surface-500">{{ where(row) }}</span>
              </span>
              <span v-if="row.status !== 'published'" class="mb-badge-warn text-2xs">{{ row.status }}</span>
              <Icon v-if="selected.includes(row.id)" name="check" class="mb-icon-sm shrink-0 text-brand-600" />
            </button>
          </li>
        </ul>
      </AsyncList>
    </div>
  </DefineResults>

  <Popover v-if="variant === 'popover'" v-model:open="open" align="end" class="w-80 p-2">
    <template #trigger>
      <button type="button" :class="triggerClass">
        <Icon v-if="triggerIcon" :name="triggerIcon" /> {{ label }}
      </button>
    </template>
    <div class="space-y-2">
      <SearchField v-model="search" label="Search documents" size="sm" :placeholder="placeholder" autofocus />
      <Results height="max-h-64" />
    </div>
  </Popover>

  <Dialog v-else-if="variant === 'dialog'" :title="label" dismissable @close="emit('close')">
    <div class="space-y-2">
      <SearchField v-model="search" label="Search documents" :placeholder="placeholder" autofocus />
      <Results height="max-h-80" />
    </div>
    <template #footer="{ close }">
      <button type="button" class="mb-btn-ghost" @click="close">Cancel</button>
    </template>
  </Dialog>

  <div v-else class="space-y-2">
    <SearchField v-model="search" label="Search documents" size="sm" :placeholder="placeholder" />
    <Results height="max-h-56" />
  </div>
</template>
