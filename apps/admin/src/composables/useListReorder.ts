import { computed, type Ref, ref } from 'vue';

/** Drag-to-reorder for a flat list. `dropAt` is an insertion point between rows. */
export function useListReorder<T>(
  items: Ref<readonly T[]> | (() => readonly T[]),
  keyOf: (item: T) => string,
  onMove: (from: number, to: number) => void,
) {
  const list = typeof items === 'function' ? computed(items) : items;
  const draggingKey = ref<string | null>(null);
  const dropAt = ref<number | null>(null);

  const draggingIndex = computed(() =>
    list.value.findIndex((item) => keyOf(item) === draggingKey.value),
  );

  /** Either side of the dragged row is a no-op. */
  function isRealMove(index: number): boolean {
    const from = draggingIndex.value;
    return from !== -1 && index !== from && index !== from + 1;
  }

  function onDragStart(event: DragEvent, key: string): void {
    draggingKey.value = key;
    event.dataTransfer?.setData('text/plain', key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd(): void {
    draggingKey.value = null;
    dropAt.value = null;
  }

  function onDragOver(event: DragEvent, index: number): void {
    if (!isRealMove(index)) return;
    event.preventDefault();
    dropAt.value = index;
  }

  function onDrop(event: DragEvent, index: number): void {
    if (!isRealMove(index)) return;
    event.preventDefault();
    const from = draggingIndex.value;
    onDragEnd();
    // Removing the row first shifts later positions down by one.
    onMove(from, index > from ? index - 1 : index);
  }

  return { draggingKey, dropAt, onDragStart, onDragEnd, onDragOver, onDrop };
}
