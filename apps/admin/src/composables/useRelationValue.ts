import { moveInList } from '@manablox/admin-sdk/lib/collections';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';

/** A relation value as ids; stored as a string or, with `multiple`, an array. */
export function useRelationValue(
  modelValue: MaybeRefOrGetter<unknown>,
  multiple: MaybeRefOrGetter<boolean>,
) {
  const isMultiple = computed(() => toValue(multiple));
  const ids = computed<string[]>(() => {
    const value = toValue(modelValue);
    if (isMultiple.value) return Array.isArray(value) ? (value as string[]) : [];
    return typeof value === 'string' ? [value] : [];
  });

  /** The value with `id` added. */
  function pick(id: string): string | string[] {
    if (!isMultiple.value) return id;
    return ids.value.includes(id) ? ids.value : [...ids.value, id];
  }

  /** The value with `id` removed; `null` for a single. */
  function remove(id: string): string[] | null {
    if (!isMultiple.value) return null;
    return ids.value.filter((entry) => entry !== id);
  }

  /** The ids with the one at `from` moved to `to`. */
  function move(from: number, to: number): string[] {
    return [...moveInList(ids.value, from, to)];
  }

  return { ids, multiple: isMultiple, pick, remove, move };
}
