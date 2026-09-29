import { type ComputedRef, computed, type Ref, shallowRef, watch } from 'vue';

/**
 * Loads a relation's records by id for display in the field's order. The lookup runs on
 * sorted ids, so reordering does not refetch, and loaded records stay while a new pick loads.
 */
export function useRelationRows<T extends { id: string }>(
  ids: Ref<string[]> | ComputedRef<string[]>,
  load: (lookupIds: ComputedRef<string[]>) => { data: Ref<readonly (T | null)[] | undefined> },
) {
  const lookupIds = computed(() => [...ids.value].sort());
  const { data } = load(lookupIds);

  const byId = shallowRef(new Map<string, T>());
  watch(
    data,
    (items) => {
      if (!items) return;
      const next = new Map(byId.value);
      for (const item of items) if (item) next.set(item.id, item);
      byId.value = next;
    },
    { immediate: true },
  );

  /** Ids in field order; records that no longer exist drop out. */
  const rows = computed(() => {
    const loaded = data.value;
    if (!loaded) return ids.value;
    const missing = new Set(lookupIds.value.filter((_, index) => !loaded[index]));
    return ids.value.filter((id) => !missing.has(id));
  });

  return { byId, rows };
}
