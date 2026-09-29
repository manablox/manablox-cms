/** Shared mechanics of the transfer and config pickers: rows of kinds, narrowed to entries. */

/** One row of an `InventoryPicker`. */
export interface InventoryRow<K extends string = string> {
  id: K;
  label: string;
  description: string;
  icon: string;
  picked: boolean;
  disabled?: boolean;
  /** Can open to narrow it down. */
  expandable: boolean;
  /** What opening it does, for its button's label. */
  expandLabel: string;
  /** The count, or how far it is narrowed; `null` shows none. */
  badge: string | number | null;
  narrowed: boolean;
}

export interface InventoryGroup<K extends string = string> {
  id: string;
  label: string;
  hint?: string | undefined;
  rows: InventoryRow<K>[];
}

/** A copy of `set` with `id` flipped. */
export function toggled<T>(set: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The picked entries of a kind; an absent list means all of them. */
export function pickedIds(chosen: readonly string[] | undefined, all: readonly { id: string }[]) {
  return new Set(chosen ?? all.map((entry) => entry.id));
}

/** `ids` with `key` narrowed to `picked`, in inventory order; all picked drops the key. */
export function narrowedIds<K extends string>(
  ids: Partial<Record<K, string[]>>,
  key: K,
  all: readonly { id: string }[],
  picked: ReadonlySet<string>,
): Partial<Record<K, string[]>> {
  const next = { ...ids };
  if (picked.size === all.length) delete next[key];
  else next[key] = all.filter((entry) => picked.has(entry.id)).map((entry) => entry.id);
  return next;
}
