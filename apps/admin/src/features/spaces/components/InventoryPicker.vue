<script setup lang="ts" generic="K extends string">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import Checkbox from '@manablox/admin-sdk/components/ui/Checkbox.vue';
import { type Ref, ref } from 'vue';
import { type InventoryGroup, type InventoryRow, toggled } from '../inventory';

/**
 * Groups of tickable rows with an All / None per group; a picked row can open to narrow
 * it down in the `detail` slot. The parent owns the selection and gets `toggle` events.
 */
defineProps<{
  groups: InventoryGroup<K>[];
  /** Per group: whether every row is picked, for the All / None label. */
  full: (group: InventoryGroup<K>) => boolean;
}>();
const emit = defineEmits<{ toggle: [id: K]; toggleGroup: [group: InventoryGroup<K>] }>();
defineSlots<{ detail?: (props: { row: InventoryRow<K> }) => unknown }>();

/** Opened rows; view state only. */
const opened = ref(new Set()) as Ref<Set<K>>;

function rowClass(row: InventoryRow<K>): string {
  if (row.disabled) return 'opacity-55';
  return row.picked ? '' : 'opacity-70';
}
</script>

<template>
  <div class="space-y-4">
    <section v-for="group in groups" :key="group.id">
      <div class="mb-1 flex items-baseline justify-between gap-2">
        <p class="mb-list-label px-0 pt-0 pb-0">
          {{ group.label }}
          <span v-if="group.hint" class="ml-1 font-normal normal-case tracking-normal text-surface-400">{{ group.hint }}</span>
        </p>
        <button type="button" class="mb-btn-ghost mb-btn-sm" @click="emit('toggleGroup', group)">
          {{ full(group) ? 'None' : 'All' }}
        </button>
      </div>

      <ul class="space-y-1.5">
        <li
          v-for="row in group.rows"
          :key="row.id"
          class="overflow-hidden rounded-card border border-surface-200 transition dark:border-surface-700"
          :class="rowClass(row)"
        >
          <div class="mb-surface-inset flex items-center gap-2 px-2.5 py-2">
            <button
              v-if="row.picked && row.expandable"
              type="button"
              class="shrink-0 text-surface-500"
              :aria-expanded="opened.has(row.id)"
              :aria-label="row.expandLabel"
              :title="row.expandLabel"
              @click="opened = toggled(opened, row.id)"
            >
              <Icon :name="opened.has(row.id) ? 'down' : 'chevron'" class="mb-icon-sm" />
            </button>
            <span v-else class="mb-icon-sm shrink-0" aria-hidden="true" />
            <Checkbox
              class="min-w-0 flex-1"
              :class="row.disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
              :model-value="row.picked"
              :disabled="row.disabled ?? false"
              @update:model-value="emit('toggle', row.id)"
            >
              <Icon :name="row.icon" class="mb-icon-sm shrink-0 text-surface-400" />
              <span class="min-w-0">
                <span class="text-sm font-medium">{{ row.label }}</span>
                <span class="block text-2xs text-surface-500">{{ row.description }}</span>
              </span>
            </Checkbox>
            <span
              v-if="row.badge !== null"
              class="mb-badge shrink-0 tabular-nums"
              :class="row.narrowed ? 'mb-badge-brand' : ''"
            >
              {{ row.badge }}
            </span>
          </div>

          <div v-if="opened.has(row.id) && row.picked" class="border-t border-surface-200 p-3 dark:border-surface-700">
            <slot name="detail" :row="row" />
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
