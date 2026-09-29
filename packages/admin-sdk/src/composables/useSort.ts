import { type Ref, ref } from 'vue';

export type SortDirection = 'asc' | 'desc';

/** A list's sort column and direction. */
export interface SortState<T extends string = string> {
  by: T;
  direction: SortDirection;
}

/** The `aria-sort` value of column `by`. */
export function ariaSort<T extends string>(
  sort: SortState<T>,
  by: T,
): 'ascending' | 'descending' | 'none' {
  if (sort.by !== by) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Flips the direction on the current column; another column starts at `firstDirection(by)`. */
export function nextSort<T extends string>(
  sort: SortState<T>,
  by: T,
  firstDirection: (by: T) => SortDirection = () => 'asc',
): SortState<T> {
  if (sort.by === by) return { by, direction: sort.direction === 'asc' ? 'desc' : 'asc' };
  return { by, direction: firstDirection(by) };
}

/** Sort state with a column toggle, for `SortHeader` / `DataTable`. */
export function useSort<T extends string>(
  initial: SortState<T>,
  firstDirection?: (by: T) => SortDirection,
): { sort: Ref<SortState<T>>; toggle: (by: T) => void } {
  const sort = ref(initial) as Ref<SortState<T>>;
  const toggle = (by: T) => {
    sort.value = nextSort(sort.value, by, firstDirection);
  };
  return { sort, toggle };
}
