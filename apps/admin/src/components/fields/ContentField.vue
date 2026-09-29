<script setup lang="ts">
import ContentPicker from '@manablox/admin-sdk/components/ContentPicker.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Loader from '@manablox/admin-sdk/components/ui/Loader.vue';
import { useContentByIds, useRelationPreview } from '@manablox/admin-sdk/features/content/queries';
import { useFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, ref } from 'vue';
import SortableList from '~/components/SortableList.vue';
import { useRelationRows } from '~/composables/useRelationRows';
import { useRelationValue } from '~/composables/useRelationValue';
import type { FieldInputProps } from '~/lib/field-input';

const props = defineProps<FieldInputProps>();
const emit = defineEmits<{ 'update:modelValue': [string | string[] | null] }>();

const context = useFieldContext();
const spaces = useSpaceStore();

const relation = useRelationValue(
  () => props.modelValue,
  () => props.settings.multiple === true,
);
const { ids, multiple } = relation;

const typeIds = computed(() =>
  Array.isArray(props.settings.types) ? (props.settings.types as string[]) : [],
);

const { byId: selectedById, rows } = useRelationRows(ids, (lookupIds) =>
  useContentByIds(lookupIds, () => context.value.spaceId),
);

/** A `filter` field stores nothing; show a read-only preview of current matches. */
const isFilter = computed(
  () => props.settings.multiple === true && props.settings.selection === 'filter',
);
const { data: matches, isPending: matching } = useRelationPreview(
  () => context.value.locale,
  () => props.settings,
  isFilter,
  () => context.value.spaceId,
);

function pick(id: string) {
  emit('update:modelValue', relation.pick(id));
}
function remove(id: string) {
  emit('update:modelValue', relation.remove(id));
}
function move(from: number, to: number) {
  emit('update:modelValue', relation.move(from, to));
}
</script>

<template>
  <div v-if="isFilter" class="space-y-2">
    <p class="mb-hint">
      Set by a filter on the content type, so it is the same on every document and always
      current. These match right now:
    </p>
    <Loader v-if="matching" inline class="px-2.5 py-2 text-sm" label="Looking..." />
    <ul v-else-if="matches?.items.length" class="space-y-1">
      <li
        v-for="item in matches.items"
        :key="item.id"
        class="flex items-center gap-2 rounded-control border border-surface-200 px-2.5 py-1.5 text-sm dark:border-surface-700"
      >
        <span class="flex-1 truncate">{{ item.title }}</span>
        <span class="truncate mb-meta">{{ item.permalink }}</span>
      </li>
    </ul>
    <p v-else class="mb-hint">Nothing matches the filter yet.</p>
  </div>

  <div v-else class="space-y-2">
    <SortableList v-if="rows.length" :items="rows" :key-of="(id) => id" :read-only="context.readOnly" @move="move">
      <template #default="{ item: id }">
        <template v-if="selectedById.get(id)">
          <Icon :name="typeIcon(spaces.typeById(selectedById.get(id)!.typeId))" class="mb-icon-sm shrink-0 text-surface-400" />
          <span class="flex-1 truncate">{{ selectedById.get(id)!.title }}</span>
          <span class="truncate mb-meta">{{ selectedById.get(id)!.permalink }}</span>
        </template>
        <Loader v-else inline class="flex-1" label="Loading..." />
      </template>
      <template #actions="{ item: id }">
        <button v-if="!context.readOnly" type="button" aria-label="Remove" @click="remove(id)"><Icon name="x" class="mb-icon-sm" /></button>
      </template>
    </SortableList>

    <ContentPicker
      v-if="!context.readOnly"
      label="Link content"
      trigger-icon="plus"
      :type-ids="typeIds"
      :selected="ids"
      :keep-open="multiple"
      :space-id="context.spaceId"
      :locale="context.locale"
      @pick="pick($event.id)"
    />
  </div>
</template>
