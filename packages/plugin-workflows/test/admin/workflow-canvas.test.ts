import { useDraftForm } from '@manablox/admin-sdk/composables/useDraftForm';
import { flushPromises, mount } from '@vue/test-utils';
import { useVueFlow } from '@vue-flow/core';
import { describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { flowNodeCache } from '../../src/admin/components/canvas/flowElements';
import WorkflowCanvas from '../../src/admin/components/canvas/WorkflowCanvas.vue';
import { type Draft, newEdge, newEventTrigger, toDraft } from '../../src/admin/model';
import type { WorkflowActionMeta, WorkflowEdge, WorkflowNode } from '../../src/sdk';

const node = (id: string, x = 0, y = 96): WorkflowNode => ({
  id,
  key: id,
  kind: 'action',
  action: 'email.send',
  credentialId: null,
  name: '',
  enabled: true,
  continueOnError: false,
  join: 'any',
  config: {},
  ui: { x, y },
});

const ACTIONS = [
  {
    type: 'email.send',
    label: 'Send an email',
    description: 'Sends one',
    icon: 'mail',
    tone: 'clay',
    available: true,
    output: { type: 'json' },
    ports: [],
    unavailable: null,
  },
] as unknown as WorkflowActionMeta[];

const INPUTS = {
  meta: ACTIONS[0],
  error: null,
  runStatus: null,
  workflowName: undefined,
  readOnly: false,
};

describe('flowNodeCache', () => {
  it('keeps an entry while its node and inputs are unchanged', () => {
    const entry = flowNodeCache();
    const a = node('a');
    const first = entry(a, INPUTS);
    expect(entry(a, { ...INPUTS })).toBe(first);
    expect(entry(a, { ...INPUTS, error: 'Broken' }).data.error).toBe('Broken');
    expect(entry({ ...a, name: 'Renamed' }, INPUTS).data.label).toBe('Renamed');
  });
});

async function settle() {
  for (let round = 0; round < 3; round++) {
    await flushPromises();
    await nextTick();
  }
}

/** Mounts the canvas as the editor does and exposes Vue Flow's live nodes. */
async function mountCanvas(nodes = [node('a'), node('b', 400), node('c', 800)]) {
  let flow!: ReturnType<typeof useVueFlow>;
  const form = useDraftForm<Draft>();
  form.load(
    toDraft(
      {
        name: '',
        trigger: newEventTrigger(),
        nodes,
        edges: [newEdge('a', 'ok', 'b'), newEdge('b', 'ok', 'c')] as WorkflowEdge[],
      },
      false,
    ),
  );
  const state = reactive({
    draft: form.draft.value as Draft,
    selectedId: null as string | null,
  });
  const renders: Record<string, number> = {};
  const Host = defineComponent({
    setup() {
      flow = useVueFlow();
      return () =>
        h(WorkflowCanvas, {
          draft: state.draft,
          actions: ACTIONS,
          readOnly: false,
          selectedId: state.selectedId,
          errors: [],
          runStatuses: {},
          'onUpdate:nodes': (nodes: WorkflowNode[]) => {
            state.draft.nodes = nodes;
          },
          onSelect: (id: string | null) => {
            state.selectedId = id;
          },
        });
    },
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      mixins: [
        {
          beforeUpdate(this: {
            $options: { __name?: string };
            $props: { data?: { node: WorkflowNode } };
          }) {
            const id = this.$options.__name === 'GraphNode' ? this.$props.data?.node.id : undefined;
            if (id) renders[id] = (renders[id] ?? 0) + 1;
          },
        },
      ],
    },
  });
  await settle();
  // Only renders after mounting settles count.
  for (const id of Object.keys(renders)) delete renders[id];
  const dataOf = () =>
    Object.fromEntries(flow.getNodes.value.map((entry) => [entry.id, entry.data]));
  return { wrapper, state, form, flow, renders, dataOf };
}

describe('WorkflowCanvas', () => {
  it('keeps the other nodes when one node changes', async () => {
    const { wrapper, state, renders, dataOf } = await mountCanvas();
    const before = dataOf();
    expect(Object.keys(before)).toHaveLength(4);

    state.draft.nodes = state.draft.nodes.map((entry) =>
      entry.id === 'b' ? { ...entry, config: { subject: 'Hello' } } : entry,
    );
    await settle();

    const after = dataOf();
    expect(after.b).not.toBe(before.b);
    expect(after.b?.subtitle).toBe('Hello');
    expect(renders.b ?? 0).toBeGreaterThan(0);
    expect(after.a).toBe(before.a);
    expect(after.c).toBe(before.c);
    expect(renders.a ?? 0).toBe(0);
    expect(renders.c ?? 0).toBe(0);
    wrapper.unmount();
  });

  it('loads an off-grid node snapped, clean, and leaves it alone when another changes', async () => {
    const { wrapper, state, form, flow, renders, dataOf } = await mountCanvas([
      node('a', 5, 101),
      node('b', 400),
      node('c', 800),
    ]);
    expect(state.draft.nodes[0]?.ui).toEqual({ x: 0, y: 96 });
    expect(flow.findNode('a')?.position).toEqual({ x: 0, y: 96 });
    expect(form.isDirty.value).toBe(false);
    const before = dataOf();

    state.draft.nodes = state.draft.nodes.map((entry) =>
      entry.id === 'b' ? { ...entry, config: { subject: 'Hello' } } : entry,
    );
    await settle();

    expect(dataOf().a).toBe(before.a);
    expect(renders.a ?? 0).toBe(0);
    expect(renders.b ?? 0).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it('selects through Vue Flow without touching node data', async () => {
    const { wrapper, state, flow, renders, dataOf } = await mountCanvas();
    const before = dataOf();

    state.selectedId = 'b';
    await settle();

    const after = dataOf();
    for (const id of Object.keys(before)) expect(after[id]).toBe(before[id]);
    expect(flow.getSelectedNodes.value.map((entry) => entry.id)).toEqual(['b']);
    expect(renders.a ?? 0).toBe(0);
    expect(renders.c ?? 0).toBe(0);

    const edgeId = state.draft.edges[0]?.id as string;
    state.selectedId = edgeId;
    await settle();
    expect(flow.getSelectedNodes.value).toHaveLength(0);
    expect(flow.getSelectedEdges.value.map((entry) => entry.id)).toEqual([edgeId]);

    state.selectedId = null;
    await settle();
    expect(flow.getSelectedElements.value).toHaveLength(0);
    wrapper.unmount();
  });

  it('selects a node added in the same tick', async () => {
    const { wrapper, state, flow } = await mountCanvas();
    state.draft.nodes = [...state.draft.nodes, node('d', 1200)];
    state.selectedId = 'd';
    await settle();
    expect(flow.getSelectedNodes.value.map((entry) => entry.id)).toEqual(['d']);
    wrapper.unmount();
  });
});
