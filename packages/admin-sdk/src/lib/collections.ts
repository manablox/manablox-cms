/** Immutable list and set edits, since a `ref<Set>` only notifies on assignment. */

export function toggleInSet<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function withInSet<T>(set: ReadonlySet<T>, key: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

export function toggleInList<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/** Moves `from` to `to`; a no-op move returns the same list instance. */
export function moveInList<T>(list: readonly T[], from: number, to: number): readonly T[] {
  if (to < 0 || to >= list.length || from < 0 || from >= list.length || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
