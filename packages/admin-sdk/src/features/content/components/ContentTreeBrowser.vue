<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../../components/Icon.vue';
import ScrollSentinel from '../../../components/ScrollSentinel.vue';
import AsyncList from '../../../components/ui/AsyncList.vue';
import Loader from '../../../components/ui/Loader.vue';
import type { ContentTreeChild } from '../../../lib/api-types';
import { typeIcon } from '../../../lib/type-icon';
import { useSpaceStore } from '../../../stores/space';
import { useTreeChildren } from '../queries';

type Doc = ContentTreeChild['content'];

/** One read-only level of the content tree for pickers; open rows mount the level below. */
const props = defineProps<{
  parentId: string | null;
  locale: string;
  /** Another space than the current one. */
  spaceId?: string | null | undefined;
  expanded: ReadonlySet<string>;
  pickable: (doc: Doc) => boolean;
  selected?: readonly string[] | undefined;
  level?: number;
}>();
const emit = defineEmits<{ pick: [doc: Doc]; toggle: [id: string] }>();

const spaces = useSpaceStore();

const { data, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
  useTreeChildren(
    () => props.locale,
    () => props.parentId,
    props.spaceId === undefined ? undefined : () => props.spaceId ?? null,
  );
const nodes = computed(() => data.value?.pages.flatMap((page) => page.items) ?? []);

const icon = (doc: Doc) =>
  spaces.isFolder(doc.typeId) ? 'folder' : typeIcon(spaces.typeById(doc.typeId));
</script>

<template>
  <AsyncList
    :pending="isPending"
    :error="error"
    :retry="refetch"
    :items="nodes"
    :rows="parentId === null ? 4 : 1"
    empty="bare"
    :empty-title="parentId === null ? 'No documents yet' : 'Nothing here'"
  >
    <ul :class="level ? 'ml-[13px] border-l border-surface-300/70 pl-1.5 dark:border-surface-700' : ''">
      <li v-for="node in nodes" :key="node.content.id">
        <div class="flex items-center gap-1">
          <button
            v-if="node.childCount > 0"
            type="button"
            class="shrink-0 rounded-sm p-0.5 text-surface-500"
            :aria-label="expanded.has(node.content.id) ? 'Collapse' : 'Expand'"
            @click="emit('toggle', node.content.id)"
          >
            <Icon :name="expanded.has(node.content.id) ? 'down' : 'chevron'" class="mb-icon-sm" />
          </button>
          <span v-else class="mb-icon-sm shrink-0 p-0.5 box-content" />

          <!-- A row that cannot be picked opens instead. -->
          <button
            type="button"
            class="mb-list-item mb-list-item-sm min-w-0 flex-1 gap-1.5"
            :class="pickable(node.content) ? '' : 'text-surface-500 dark:text-surface-400'"
            :title="node.content.title || 'Untitled'"
            :disabled="!pickable(node.content) && node.childCount === 0"
            @click="pickable(node.content) ? emit('pick', node.content) : emit('toggle', node.content.id)"
          >
            <Icon :name="icon(node.content)" class="mb-icon-sm shrink-0 text-surface-500" />
            <span class="min-w-0 flex-1 truncate">{{ node.content.title || 'Untitled' }}</span>
            <Icon v-if="selected?.includes(node.content.id)" name="check" class="mb-icon-sm shrink-0 text-brand-600" />
          </button>
        </div>

        <ContentTreeBrowser
          v-if="expanded.has(node.content.id)"
          :parent-id="node.content.id"
          :locale="locale"
          :space-id="spaceId"
          :expanded="expanded"
          :pickable="pickable"
          :selected="selected"
          :level="(level ?? 0) + 1"
          @pick="emit('pick', $event)"
          @toggle="emit('toggle', $event)"
        />
      </li>

      <li v-if="hasNextPage">
        <ScrollSentinel :disabled="isFetchingNextPage" @reach="fetchNextPage()" />
        <Loader v-if="isFetchingNextPage" inline class="px-2 py-1 text-xs" label="Loading more..." />
      </li>
    </ul>
  </AsyncList>
</template>
