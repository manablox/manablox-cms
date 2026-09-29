import { toast } from '@manablox/admin-sdk';
import { computed, type Ref, ref } from 'vue';
import {
  WORKFLOW_TRIGGER_ID,
  type WorkflowActionMeta,
  type WorkflowEdge,
  type WorkflowNode,
  workflowNodePorts,
} from '../sdk';
import {
  autoLayout,
  CONTROL_NODES,
  type ControlNodeKind,
  type Draft,
  freePort,
  type LayoutDensity,
  newActionNode,
  newEdge,
  type PaletteEntry,
  spotUnder,
} from './model';

/** The editor's graph edits on a draft: the selection, adding, replacing, removing and tidying. */
export function useWorkflowGraph(
  draft: Ref<Draft | null>,
  actions: Ref<WorkflowActionMeta[] | undefined>,
) {
  /** The inspected node, edge or trigger. */
  const selectedId = ref<string | null>(null);

  const keys = computed(() => (draft.value?.nodes ?? []).map((node) => node.key));

  /** The node with no outgoing edge yet, lowest first. */
  function lastNode(current: Draft): WorkflowNode | null {
    if (!current.nodes.length) return null;
    const open = current.nodes.filter(
      (node) => !current.edges.some((edge) => edge.from === node.id),
    );
    const candidates = open.length ? open : current.nodes;
    return candidates.reduce(
      (low, node) => (node.ui.y > low.ui.y ? node : low),
      candidates[0] as WorkflowNode,
    );
  }

  /** Where a palette node joins: the selection (trigger included), else the chain's end. */
  function anchor(current: Draft): WorkflowNode | null {
    const picked = current.nodes.find((node) => node.id === selectedId.value);
    if (picked) return picked;
    if (selectedId.value === WORKFLOW_TRIGGER_ID) return null;
    return lastNode(current);
  }

  /** Places a new node under the socket it joins, which is beside a fork. */
  function add(make: (spot: { x: number; y: number }) => WorkflowNode) {
    const current = draft.value;
    if (!current) return;
    const from = anchor(current);
    const port = freePort(from, actions.value ?? [], current.edges);
    const node = make(spotUnder(current.nodes, from, port));
    current.nodes = [...current.nodes, node];
    current.edges = [...current.edges, newEdge(from?.id ?? WORKFLOW_TRIGGER_ID, port, node.id)];
    selectedId.value = node.id;
  }

  const addAction = (meta: WorkflowActionMeta) =>
    add((spot) => newActionNode(meta, spot, keys.value));
  const addControl = (kind: ControlNodeKind) =>
    add((spot) => CONTROL_NODES[kind].create(spot, keys.value));

  /** Places a dragged-in node where it was dropped, not joined to anything yet. */
  function drop(entry: PaletteEntry, at: { x: number; y: number }) {
    const current = draft.value;
    if (!current) return;
    let node: WorkflowNode;
    if (entry.kind === 'control') {
      const control = CONTROL_NODES[entry.control];
      if (!control) return;
      node = control.create(at, keys.value);
    } else {
      const meta = actions.value?.find((action) => action.type === entry.type);
      if (!meta) return;
      node = newActionNode(meta, at, keys.value);
    }
    current.nodes = [...current.nodes, node];
    selectedId.value = node.id;
  }

  /** A control node that loses a port, like a removed switch case, loses its lines too. */
  function updateNode(node: WorkflowNode) {
    const current = draft.value;
    if (!current) return;
    current.nodes = current.nodes.map((entry) => (entry.id === node.id ? node : entry));
    if (node.kind === 'action') return;
    const ports = new Set(workflowNodePorts(node).map((port) => port.name));
    if (current.edges.some((edge) => edge.from === node.id && !ports.has(edge.fromPort))) {
      current.edges = current.edges.filter(
        (edge) => edge.from !== node.id || ports.has(edge.fromPort),
      );
    }
  }

  function updateEdge(edge: WorkflowEdge) {
    if (draft.value) {
      draft.value.edges = draft.value.edges.map((entry) => (entry.id === edge.id ? edge : entry));
    }
  }

  /** Removes the selection and any dangling lines. */
  function removeSelected() {
    const current = draft.value;
    const gone = selectedId.value;
    if (!current || !gone) return;
    current.nodes = current.nodes.filter((node) => node.id !== gone);
    current.edges = current.edges.filter(
      (edge) => edge.id !== gone && edge.from !== gone && edge.to !== gone,
    );
    selectedId.value = null;
  }

  function tidy(density: LayoutDensity, heights?: ReadonlyMap<string, number>) {
    if (!draft.value) return;
    draft.value.nodes = autoLayout(draft.value.nodes, draft.value.edges, density, heights);
    toast.success(density === 'compact' ? 'Packed the nodes closer' : 'Spread the nodes out');
  }

  return { selectedId, addAction, addControl, drop, updateNode, updateEdge, removeSelected, tidy };
}
