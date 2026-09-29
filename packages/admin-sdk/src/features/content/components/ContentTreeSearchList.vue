<script setup lang="ts">
import Icon from '../../../components/Icon.vue';
import { typeIcon } from '../../../lib/type-icon';
import { useSpaceStore } from '../../../stores/space';
import { highlightParts, type TreeSearchDocument, type TreeSearchRow } from '../model/tree-search';

/**
 * Search hits drawn in place in the tree, ancestors muted. With `to` every row is a link;
 * otherwise `pickable` rows are buttons that emit `pick`.
 */
const props = defineProps<{
  rows: readonly TreeSearchRow[];
  term: string;
  to?: ((doc: TreeSearchDocument) => string) | undefined;
  pickable?: ((doc: TreeSearchDocument) => boolean) | undefined;
  activeId?: string | null | undefined;
  selected?: readonly string[] | undefined;
}>();
const emit = defineEmits<{ pick: [doc: TreeSearchDocument] }>();

const spaces = useSpaceStore();

const icon = (doc: TreeSearchDocument) =>
  spaces.isFolder(doc.typeId) ? 'folder' : typeIcon(spaces.typeById(doc.typeId));
const canPick = (doc: TreeSearchDocument) => (props.pickable ? props.pickable(doc) : true);
const indent = (row: TreeSearchRow) => ({ paddingLeft: `calc(${row.depth * 0.875}rem + 0.5rem)` });
</script>

<template>
  <ul>
    <li v-for="row in rows" :key="row.content.id">
      <component
        :is="to ? 'RouterLink' : canPick(row.content) ? 'button' : 'div'"
        v-bind="to ? { to: to(row.content) } : canPick(row.content) ? { type: 'button' } : {}"
        class="mb-list-item mb-list-item-sm gap-1.5"
        :class="[
          row.match ? '' : 'text-surface-500 dark:text-surface-400',
          !to && !canPick(row.content) ? 'pointer-events-none' : '',
          activeId === row.content.id ? 'mb-list-item-active' : '',
        ]"
        :style="indent(row)"
        :title="row.content.title || 'Untitled'"
        @click="!to && canPick(row.content) && emit('pick', row.content)"
      >
        <Icon :name="icon(row.content)" class="mb-icon-sm shrink-0 text-surface-500" />
        <span class="min-w-0 flex-1 truncate" :class="row.match ? 'font-medium' : ''">
          <template v-for="(part, index) in highlightParts(row.content.title || 'Untitled', row.match ? term : '')" :key="index">
            <mark v-if="part.hit" class="rounded-sm bg-warn-200/80 text-inherit dark:bg-warn-500/35">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
        <Icon v-if="selected?.includes(row.content.id)" name="check" class="mb-icon-sm shrink-0 text-brand-600" />
      </component>
    </li>
  </ul>
</template>
