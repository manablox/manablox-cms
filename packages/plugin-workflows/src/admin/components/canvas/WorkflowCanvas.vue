<script setup lang="ts">
import { type ApiErrorDetail, messageForKey } from '@manablox/admin-sdk';
import {
  snapWorkflowPosition,
  WORKFLOW_GRID,
  WORKFLOW_TRIGGER_ID,
  type WorkflowActionMeta,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../../sdk';
// Imported here, not globally: only this page needs it and it is large.
import '../../canvas.css';
import {
  type Connection,
  type EdgeChange,
  type GraphNode as FlowNode,
  type NodeChange,
  type NodeDragEvent,
  useVueFlow,
  VueFlow,
} from '@vue-flow/core';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import {
  type Draft,
  newEdge,
  PALETTE_DRAG_TYPE,
  type PaletteEntry,
  triggerKind,
} from '../../model';
import { flowEdgeCache, flowNodeCache } from './flowElements';
import GraphNode from './GraphNode.vue';
import { alignmentFor, type Guide } from './guides';
import TriggerNode from './TriggerNode.vue';

// The canvas add-ons arrive after the canvas mounts, each from its own chunk.
const Background = defineAsyncComponent(() =>
  import('@vue-flow/background').then((module) => module.Background),
);
const Controls = defineAsyncComponent(() =>
  import('@vue-flow/controls').then((module) => module.Controls),
);
const MiniMap = defineAsyncComponent(() =>
  import('@vue-flow/minimap').then((module) => module.MiniMap),
);

/** The workflow canvas. Vue Flow owns interaction; every change is emitted as a new array. */
const props = defineProps<{
  draft: Draft;
  actions: WorkflowActionMeta[];
  readOnly: boolean;
  selectedId: string | null;
  /** Server errors; a node's card shows the first under its path. */
  errors?: ApiErrorDetail[] | undefined;
  /** Node key -> the status it reached in the run being inspected. */
  runStatuses: Record<string, string>;
  /** Workflow id -> name, for what call nodes run. */
  workflowNames?: Record<string, string> | undefined;
}>();
const emit = defineEmits<{
  'update:nodes': [nodes: WorkflowNode[]];
  'update:edges': [edges: WorkflowEdge[]];
  select: [id: string | null];
  /** A palette entry dropped on the pane, with the flow position for the node's top left. */
  drop: [entry: PaletteEntry, at: { x: number; y: number }];
}>();

const actionsByType = computed(() => new Map(props.actions.map((action) => [action.type, action])));

/** Node index -> the first error anywhere under it, for the badge on its card. */
const errorsByIndex = computed(() => {
  const found = new Map<number, string>();
  for (const detail of props.errors ?? []) {
    const index = detail.path?.[1];
    if (detail.path?.[0] !== 'nodes' || typeof index !== 'number' || found.has(index)) continue;
    found.set(index, messageForKey(detail.key, detail.params));
  }
  return found;
});

const triggerDetail = computed(() => {
  const trigger = props.draft.trigger;
  const aborts = props.draft.abortTriggers.length;
  const suffix = aborts ? ` - ${aborts} abort trigger${aborts === 1 ? '' : 's'}` : '';
  const what =
    trigger.kind === 'event'
      ? `${trigger.events.length} content event${trigger.events.length === 1 ? '' : 's'}`
      : triggerKind(trigger.kind).label;
  return `${what}${suffix}`;
});

const triggerIcon = computed(() => triggerKind(props.draft.trigger.kind).icon);

const triggerEntry = computed(() => ({
  id: WORKFLOW_TRIGGER_ID,
  type: 'trigger',
  position: { x: 0, y: 0 },
  draggable: false,
  deletable: false,
  data: { label: 'When this happens', detail: triggerDetail.value, icon: triggerIcon.value },
}));

const nodeEntry = flowNodeCache();

// Selection stays out of here; Vue Flow's own `selected` carries it.
const nodes = computed(() => [
  triggerEntry.value,
  ...props.draft.nodes.map((node, index) =>
    nodeEntry(node, {
      meta: node.kind === 'action' ? actionsByType.value.get(node.action) : undefined,
      error: errorsByIndex.value.get(index) ?? null,
      runStatus: props.runStatuses[node.key] ?? null,
      workflowName:
        node.kind === 'call' && node.workflowId
          ? props.workflowNames?.[node.workflowId]
          : undefined,
      readOnly: props.readOnly,
    }),
  ),
]);

const {
  viewport,
  getNodes,
  dimensions,
  fitView,
  getViewport,
  setViewport,
  getSelectedElements,
  findNode,
  findEdge,
  addSelectedNodes,
  addSelectedEdges,
  removeSelectedElements,
  screenToFlowCoordinate,
} = useVueFlow();

/** Opening zoom as a fraction of the fit-to-view zoom. */
const OPENING_ZOOM = 0.5;

/** Fits the graph, then zooms to `OPENING_ZOOM` of that around the pane's centre. */
async function onPaneReady() {
  await fitView({ padding: 0.15 });
  const { x, y, zoom } = getViewport();
  const zoomed = zoom * OPENING_ZOOM;
  const centreX = dimensions.value.width / 2;
  const centreY = dimensions.value.height / 2;
  setViewport({
    zoom: zoomed,
    x: centreX - (centreX - x) * OPENING_ZOOM,
    y: centreY - (centreY - y) * OPENING_ZOOM,
  });
  syncSelection(props.selectedId);
}

const edgeEntry = flowEdgeCache();

const edges = computed(() => props.draft.edges.map(edgeEntry));

/** Mirrors `selectedId` into Vue Flow's selection. */
function syncSelection(id: string | null) {
  const selected = getSelectedElements.value;
  if (id ? selected.length === 1 && selected[0]?.id === id : !selected.length) return;
  const node = id ? findNode(id) : undefined;
  const edge = id && !node ? findEdge(id) : undefined;
  if (node) addSelectedNodes([node]);
  else if (edge) addSelectedEdges([edge]);
  else removeSelectedElements();
}

watch(() => props.selectedId, syncSelection, { flush: 'post' });

/** Rendered card heights by node id, for laying the graph out around them. */
function cardHeights(): Map<string, number> {
  return new Map(getNodes.value.map((node: FlowNode) => [node.id, node.dimensions.height]));
}

defineExpose({ cardHeights });

// --- dragging -------------------------------------------------------------------------

/** Alignment lines for the drag in progress, in flow coordinates. */
const guides = ref<Guide[]>([]);

/** Snap distance in screen pixels. */
const SNAP_DISTANCE = 8;

/** Snaps a dragged node to near alignments and draws the guide. Vue Flow reads the mutated position back. */
function onDrag(event: NodeDragEvent) {
  if (props.readOnly) return;
  const others = getNodes.value.filter((node: FlowNode) => node.id !== event.node.id);
  const {
    dx,
    dy,
    guides: found,
  } = alignmentFor(event.node, others, SNAP_DISTANCE / (viewport.value.zoom || 1));
  event.node.position = { x: event.node.position.x + dx, y: event.node.position.y + dy };
  guides.value = found;
}

/** A flow-coordinate guide as screen pixels. */
function guideStyle(guide: Guide) {
  const { x, y, zoom } = viewport.value;
  return guide.axis === 'x'
    ? {
        left: `${guide.at * zoom + x}px`,
        top: `${guide.from * zoom + y}px`,
        height: `${(guide.to - guide.from) * zoom}px`,
        width: '1px',
      }
    : {
        top: `${guide.at * zoom + y}px`,
        left: `${guide.from * zoom + x}px`,
        width: `${(guide.to - guide.from) * zoom}px`,
        height: '1px',
      };
}

// --- dropping from the palette -------------------------------------------------------

/** A palette entry is over the pane. */
const dropping = ref(false);

/** Where the cursor sits on a dropped node: the middle of its header. */
const GRAB = { x: 144, y: 28 };

const carriesEntry = (event: DragEvent) =>
  !props.readOnly && Boolean(event.dataTransfer?.types.includes(PALETTE_DRAG_TYPE));

function onDragOver(event: DragEvent) {
  if (!carriesEntry(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dropping.value = true;
}

function onDragLeave(event: DragEvent) {
  const pane = event.currentTarget as HTMLElement | null;
  if (!pane?.contains(event.relatedTarget as Node | null)) dropping.value = false;
}

function onDrop(event: DragEvent) {
  dropping.value = false;
  if (!carriesEntry(event)) return;
  event.preventDefault();
  let entry: PaletteEntry;
  try {
    entry = JSON.parse(event.dataTransfer?.getData(PALETTE_DRAG_TYPE) ?? '');
  } catch {
    return;
  }
  const at = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  emit('drop', entry, { x: at.x - GRAB.x, y: at.y - GRAB.y });
}

// --- changes coming back out ----------------------------------------------------------

/** Writes dragged positions into the draft when the drag ends. */
function onDragStop(event: { nodes: Array<{ id: string; position: { x: number; y: number } }> }) {
  guides.value = [];
  if (props.readOnly) return;
  const moved = new Map(event.nodes.map((node) => [node.id, node.position]));
  emit(
    'update:nodes',
    props.draft.nodes.map((node) => {
      const position = moved.get(node.id);
      return position ? { ...node, ui: snapWorkflowPosition(position) } : node;
    }),
  );
}

function onConnect(connection: Connection) {
  if (props.readOnly) return;
  const { source, target, sourceHandle } = connection;
  if (!source || !target || source === target) return;
  const port = sourceHandle ?? 'ok';
  // No duplicate edges.
  if (
    props.draft.edges.some(
      (edge) => edge.from === source && edge.fromPort === port && edge.to === target,
    )
  ) {
    return;
  }
  emit('update:edges', [...props.draft.edges, newEdge(source, port, target)]);
}

function onNodesChange(changes: NodeChange[]) {
  if (props.readOnly) return;
  const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
  if (!removed.length) return;
  emit(
    'update:nodes',
    props.draft.nodes.filter((node) => !removed.includes(node.id)),
  );
  // Drop edges to removed nodes.
  emit(
    'update:edges',
    props.draft.edges.filter((edge) => !removed.includes(edge.from) && !removed.includes(edge.to)),
  );
}

function onEdgesChange(changes: EdgeChange[]) {
  if (props.readOnly) return;
  const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
  if (!removed.length) return;
  emit(
    'update:edges',
    props.draft.edges.filter((edge) => !removed.includes(edge.id)),
  );
}
</script>

<template>
  <VueFlow
    :nodes="nodes"
    :edges="edges"
    :nodes-connectable="!readOnly"
    :nodes-draggable="!readOnly"
    :elements-selectable="true"
    :delete-key-code="readOnly ? null : ['Backspace', 'Delete']"
    :min-zoom="0.1"
    :max-zoom="1.75"
    snap-to-grid
    :snap-grid="[WORKFLOW_GRID, WORKFLOW_GRID]"
    class="wf-canvas wf:h-full wf:w-full"
    :class="{ 'wf-canvas-dropping': dropping }"
    @pane-ready="onPaneReady"
    @node-drag="onDrag"
    @node-drag-stop="onDragStop"
    @connect="onConnect"
    @nodes-change="onNodesChange"
    @edges-change="onEdgesChange"
    @node-click="emit('select', $event.node.id)"
    @edge-click="emit('select', $event.edge.id)"
    @pane-click="emit('select', null)"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <template #node-trigger="nodeProps">
      <TriggerNode v-bind="nodeProps" />
    </template>
    <template #node-graph="nodeProps">
      <GraphNode v-bind="nodeProps" />
    </template>
    <!-- Alignment guides, in screen pixels. -->
    <span
      v-for="(guide, index) in guides"
      :key="index"
      class="wf-canvas-guide"
      :style="guideStyle(guide)"
      aria-hidden="true"
    />

    <Background pattern-color="var(--canvas-dot)" :gap="16" />
    <Controls :show-interactive="false" position="bottom-right" />
    <MiniMap pannable zoomable :width="150" :height="100" class="wf:hidden wf:sm:block" />
  </VueFlow>
</template>
