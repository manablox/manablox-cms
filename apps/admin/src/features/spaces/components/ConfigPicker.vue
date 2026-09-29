<script setup lang="ts">
import { computed } from 'vue';
import {
  type ConfigInventory,
  type ConfigKind,
  type ConfigSelection,
  configKinds,
  kindEntries,
} from '../config-kinds';
import { type InventoryGroup, narrowedIds, pickedIds, toggled } from '../inventory';
import InventoryEntries from './InventoryEntries.vue';
import InventoryPicker from './InventoryPicker.vue';

/** Picks the kinds and entries for the generated `manablox.config.ts`. */
const props = defineProps<{ inventory: ConfigInventory | null }>();
const selection = defineModel<ConfigSelection>({ required: true });

const kinds = computed(() => configKinds(props.inventory));
const entriesOf = (kind: ConfigKind) => kindEntries(props.inventory, kind);
const pickedEntries = (kind: ConfigKind) => pickedIds(selection.value.ids[kind], entriesOf(kind));

/** How far a kind is narrowed, if it is. */
function narrowing(kind: ConfigKind): string | null {
  const chosen = selection.value.ids[kind];
  return chosen ? `${chosen.length} of ${entriesOf(kind).length}` : null;
}

const groups = computed<InventoryGroup<ConfigKind>[]>(() => [
  {
    id: 'declare',
    label: 'Declare',
    rows: kinds.value.map((kind) => {
      const count = entriesOf(kind.id).length;
      const narrowed = narrowing(kind.id);
      return {
        id: kind.id,
        label: kind.label,
        description: kind.description,
        icon: kind.icon,
        picked: selection.value.kinds.includes(kind.id),
        expandable: count > 0,
        expandLabel: `Choose which ${kind.label.toLowerCase()} are written`,
        badge: narrowed ?? (count || null),
        narrowed: narrowed !== null,
      };
    }),
  },
]);

/** Emits in file order. */
function setKinds(picked: ReadonlySet<ConfigKind>) {
  selection.value = {
    ...selection.value,
    kinds: kinds.value.map((kind) => kind.id).filter((id) => picked.has(id)),
  };
}

const everythingPicked = () => kinds.value.every((kind) => selection.value.kinds.includes(kind.id));

function toggleAll() {
  setKinds(everythingPicked() ? new Set() : new Set(kinds.value.map((kind) => kind.id)));
}

function setEntries(kind: ConfigKind, picked: ReadonlySet<string>) {
  selection.value = {
    ...selection.value,
    ids: narrowedIds(selection.value.ids, kind, entriesOf(kind), picked),
  };
}

function allEntries(kind: ConfigKind, on: boolean) {
  setEntries(kind, on ? pickedIds(undefined, entriesOf(kind)) : new Set());
}
</script>

<template>
  <InventoryPicker
    :groups="groups"
    :full="everythingPicked"
    @toggle="setKinds(toggled(new Set(selection.kinds), $event))"
    @toggle-group="toggleAll"
  >
    <template #detail="{ row }">
      <InventoryEntries
        :entries="entriesOf(row.id)"
        :picked="pickedEntries(row.id)"
        verb="written"
        @toggle="setEntries(row.id, toggled(pickedEntries(row.id), $event))"
        @all="allEntries(row.id, $event)"
      />
    </template>
  </InventoryPicker>
</template>
