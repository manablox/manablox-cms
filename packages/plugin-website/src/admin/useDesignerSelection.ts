import { type DesignNode, findNode } from '@manablox/site';
import { computed, ref, watch } from 'vue';
import { bindingLabel } from './model/bindings';
import { nodeLabel, outlineRows } from './model/outline';
import type { DesignerOptions } from './useDesigner';

/** The selected and hovered node of a design tree, and its Layers rows. */
export function useDesignerSelection(options: Pick<DesignerOptions, 'root' | 'fields'>) {
  const selectedId = ref<string | null>(null);
  const hoveredId = ref<string | null>(null);

  const selected = computed(() => {
    const root = options.root();
    return root && selectedId.value ? findNode(root, selectedId.value) : null;
  });

  // A selection whose node went away (undo, delete elsewhere) is dropped.
  watch(options.root, (root) => {
    if (selectedId.value && (!root || !findNode(root, selectedId.value))) selectedId.value = null;
    if (hoveredId.value && (!root || !findNode(root, hoveredId.value))) hoveredId.value = null;
  });

  const labelFor = (node: DesignNode) =>
    nodeLabel(node, (path) => bindingLabel(options.fields(), path));
  const collapsed = ref(new Set<string>());
  const rows = computed(() => {
    const root = options.root();
    return root ? outlineRows(root, labelFor, collapsed.value) : [];
  });

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed.value = next;
  }

  function select(id: string | null) {
    selectedId.value = id;
  }

  function hover(id: string | null) {
    hoveredId.value = id;
  }

  return {
    selectedId,
    hoveredId,
    selected,
    rows,
    collapsed,
    labelFor,
    toggleCollapsed,
    select,
    hover,
  };
}
