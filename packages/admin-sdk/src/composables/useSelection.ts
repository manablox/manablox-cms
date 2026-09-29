import { computed, type MaybeRefOrGetter, onBeforeUnmount, ref, toValue, watch } from 'vue';
import { useShortcuts } from './useShortcuts';

export interface SelectionOptions<T> {
  /** The items, in the order the list shows them. */
  items: MaybeRefOrGetter<readonly T[]>;
  keyOf: (item: T) => string;
  /** Scroll container for the rubber band; items carry `data-id`. */
  container: MaybeRefOrGetter<HTMLElement | null>;
  /** While true, Escape and Cmd+A are not bound. */
  suspended?: MaybeRefOrGetter<boolean>;
  /** Item name for the help dialog: "Select every asset". */
  noun?: string;
}

/** Multi-select with click, Ctrl/Shift-click, Cmd+A, Escape and a rubber band. */
export function useSelection<T>(options: SelectionOptions<T>) {
  const selected = ref<Set<string>>(new Set());
  /** Where a Shift-click range starts. */
  const anchor = ref<string | null>(null);

  const keys = computed(() => toValue(options.items).map(options.keyOf));
  const size = computed(() => selected.value.size);
  const allSelected = computed(
    () => keys.value.length > 0 && keys.value.every((key) => selected.value.has(key)),
  );
  const isSelected = (key: string) => selected.value.has(key);
  const selectedItems = computed(() =>
    toValue(options.items).filter((item) => selected.value.has(options.keyOf(item))),
  );

  /** The single selected key, else `null`. Setting it selects only that key. */
  const only = computed<string | null>({
    get: () => (selected.value.size === 1 ? ([...selected.value][0] ?? null) : null),
    set: (key) => {
      selected.value = new Set(key ? [key] : []);
      anchor.value = key;
    },
  });

  function select(
    key: string,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  ) {
    const list = keys.value;
    if (event.shiftKey && anchor.value && list.includes(anchor.value)) {
      const from = Math.min(list.indexOf(anchor.value), list.indexOf(key));
      const to = Math.max(list.indexOf(anchor.value), list.indexOf(key));
      const run = list.slice(from, to + 1);
      selected.value = new Set(event.ctrlKey || event.metaKey ? [...selected.value, ...run] : run);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected.value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selected.value = next;
      anchor.value = key;
      return;
    }
    // A plain click on the only selected item deselects it.
    only.value = only.value === key ? null : key;
  }

  function selectAll() {
    selected.value = new Set(keys.value);
  }
  function clear() {
    selected.value = new Set();
  }

  // Drop selections for items that left the list.
  watch(keys, (list) => {
    const present = new Set(list);
    if ([...selected.value].some((key) => !present.has(key))) {
      selected.value = new Set([...selected.value].filter((key) => present.has(key)));
    }
  });

  const live = () => !toValue(options.suspended);
  useShortcuts(() => [
    {
      keys: 'mod+a',
      label: `Select every ${options.noun ?? 'item'}`,
      enabled: () => live() && keys.value.length > 0,
      run: selectAll,
    },
    {
      keys: 'Escape',
      label: 'Clear the selection',
      enabled: () => live() && selected.value.size > 0,
      run: clear,
    },
  ]);

  // --- rubber band ----------------------------------------------------------------

  /** In the container's content coordinates. */
  const band = ref<{ left: number; top: number; width: number; height: number } | null>(null);
  let bandStart: { x: number; y: number; additive: boolean; base: Set<string> } | null = null;

  function contentPoint(event: PointerEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + el.scrollLeft,
      y: event.clientY - rect.top + el.scrollTop,
    };
  }

  /** Bind to `pointerdown` on the container; ignores items and controls. */
  function onBandStart(event: PointerEvent) {
    const el = toValue(options.container);
    if (event.button !== 0 || !el) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-id], button, a, input, label')) return;
    bandStart = {
      ...contentPoint(event, el),
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      base: new Set(selected.value),
    };
    window.addEventListener('pointermove', onBandMove);
    window.addEventListener('pointerup', onBandEnd, { once: true });
  }

  function onBandMove(event: PointerEvent) {
    const el = toValue(options.container);
    if (!bandStart || !el) return;
    const point = contentPoint(event, el);
    const rect = {
      left: Math.min(bandStart.x, point.x),
      top: Math.min(bandStart.y, point.y),
      width: Math.abs(point.x - bandStart.x),
      height: Math.abs(point.y - bandStart.y),
    };
    // Ignore clicks that barely move.
    if (!band.value && rect.width < 4 && rect.height < 4) return;
    band.value = rect;
    event.preventDefault();

    const origin = el.getBoundingClientRect();
    const hit = new Set(bandStart.additive ? bandStart.base : []);
    for (const node of el.querySelectorAll<HTMLElement>('[data-id]')) {
      const b = node.getBoundingClientRect();
      const left = b.left - origin.left + el.scrollLeft;
      const top = b.top - origin.top + el.scrollTop;
      const overlaps =
        left < rect.left + rect.width &&
        left + b.width > rect.left &&
        top < rect.top + rect.height &&
        top + b.height > rect.top;
      if (overlaps) hit.add(node.dataset.id as string);
    }
    selected.value = hit;
  }

  function onBandEnd() {
    window.removeEventListener('pointermove', onBandMove);
    // A plain click on empty space clears the selection.
    if (!band.value && bandStart && !bandStart.additive) clear();
    band.value = null;
    bandStart = null;
  }
  onBeforeUnmount(() => window.removeEventListener('pointermove', onBandMove));

  const bandStyle = computed(() =>
    band.value
      ? {
          left: `${band.value.left}px`,
          top: `${band.value.top}px`,
          width: `${band.value.width}px`,
          height: `${band.value.height}px`,
        }
      : undefined,
  );

  return {
    selected,
    size,
    only,
    selectedItems,
    isSelected,
    allSelected,
    select,
    selectAll,
    clear,
    band,
    bandStyle,
    onBandStart,
  };
}
