import { SpaceConfigService } from '@manablox/services';
import { createServiceContext, type ServiceContext } from '@manablox/services/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defineWorkflow,
  WORKFLOW_TRIGGER_ID,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '../src/define.js';
import { stepsFromGraph } from '../src/server/config-steps.js';
import { workflowRepos } from '../src/server/db/index.js';
import { workflowsPlugin } from '../src/server/plugin.js';

/** Workflow steps rendered from a graph must build the same graph again. */
const options = {
  credentialSlug: (id: string) => (id === 'cred' ? 'mailer' : null),
  workflowSlug: (id: string) => (id === 'wf-sub' ? 'send_order' : null),
  deref: <T>(v: T) => v,
};

const node = (over: Partial<WorkflowNode> & { key: string }): WorkflowNode =>
  ({
    id: `id-${over.key}`,
    name: '',
    enabled: true,
    continueOnError: false,
    join: 'any',
    ui: { x: 0, y: 0 },
    kind: 'action',
    action: 'email',
    config: {},
    credentialId: null,
    ...over,
  }) as WorkflowNode;

const edge = (from: string, fromPort: string, to: string): WorkflowEdge => ({
  id: `${from}:${fromPort}:${to}`,
  from: from === WORKFLOW_TRIGGER_ID ? from : `id-${from}`,
  fromPort,
  to: `id-${to}`,
  guard: null,
});

/** The graph as `from -> to` pairs by key. */
function wiring(graph: WorkflowGraph): string[] {
  const keyOf = new Map(graph.nodes.map((n) => [n.id, n.key]));
  return graph.edges
    .map(
      (e) =>
        `${e.from === WORKFLOW_TRIGGER_ID ? 'trigger' : keyOf.get(e.from)}:${e.fromPort} -> ${keyOf.get(e.to)}`,
    )
    .sort();
}

const rebuild = (nodes: WorkflowNode[], edges: WorkflowEdge[]) => {
  const { steps, unexpressed } = stepsFromGraph(nodes, edges, options);
  const built = defineWorkflow({
    slug: 'flow',
    trigger: { kind: 'event', events: ['content.created'] },
    steps,
  });
  return { steps, unexpressed, graph: built.graph };
};

describe('a workflow read back as steps', () => {
  it('round-trips a straight chain, leaving the wiring implicit', () => {
    const nodes = [node({ key: 'first' }), node({ key: 'second' }), node({ key: 'third' })];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'first'),
      edge('first', 'ok', 'second'),
      edge('second', 'ok', 'third'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    // Sequential steps need no `after`.
    expect(steps.every((step) => !('after' in step))).toBe(true);
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips a condition as its two branches', () => {
    const nodes = [
      node({ key: 'check', kind: 'condition', match: 'all', rules: [] } as never),
      node({ key: 'yes' }),
      node({ key: 'no' }),
    ];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'check'),
      edge('check', 'true', 'yes'),
      edge('check', 'false', 'no'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[0]).toMatchObject({ key: 'check', then: 'yes', else: 'no' });
    // Branch targets are not chained, so neither needs an `after`.
    expect(steps[1]).not.toHaveProperty('after');
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips a call with its error branch, naming the workflow by slug', () => {
    const nodes = [
      node({
        key: 'send',
        kind: 'call',
        workflowId: 'wf-sub',
        input: [{ name: 'orderId', value: '{{ content.id }}' }],
        wait: false,
      } as never),
      node({ key: 'after' }),
      node({ key: 'oops' }),
    ];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'send'),
      edge('send', 'ok', 'after'),
      edge('send', 'error', 'oops'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[0]).toMatchObject({
      key: 'send',
      call: { workflow: 'send_order', input: { orderId: '{{ content.id }}' }, wait: false },
      onError: 'oops',
    });
    expect(graph.nodes[0]).toMatchObject({ kind: 'call', wait: false });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips a fan-out and the join that follows it', () => {
    const nodes = [
      node({ key: 'fan' }),
      node({ key: 'left' }),
      node({ key: 'right' }),
      node({ key: 'join', join: 'all' }),
    ];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'fan'),
      edge('fan', 'ok', 'left'),
      edge('fan', 'ok', 'right'),
      edge('left', 'ok', 'join'),
      edge('right', 'ok', 'join'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[3]).toMatchObject({ key: 'join', after: ['left', 'right'], join: 'all' });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips a loop as its branch and what follows the last item', () => {
    const nodes = [
      node({ key: 'fetch' }),
      node({ key: 'each', kind: 'loop', items: '{{ nodes.fetch.to }}', maxItems: 20 } as never),
      node({ key: 'per_item' }),
      node({ key: 'then_more' }),
      node({ key: 'after' }),
    ];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'fetch'),
      edge('fetch', 'ok', 'each'),
      edge('each', 'each', 'per_item'),
      edge('per_item', 'ok', 'then_more'),
      edge('each', 'done', 'after'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[1]).toMatchObject({
      key: 'each',
      loop: { items: '{{ nodes.fetch.to }}', maxItems: 20 },
      each: 'per_item',
    });
    expect(graph.nodes[1]).toMatchObject({ kind: 'loop', maxItems: 20 });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips a switch as its cases and what happens otherwise', () => {
    const cases = [
      { id: 'news', label: 'News', operator: 'equals', value: 'news' },
      { id: 'case_2', label: '', operator: 'contains', value: 'blog' },
      { id: 'case_3', label: '', operator: 'equals', value: 'x' },
    ];
    const nodes = [
      node({ key: 'pick', kind: 'switch', field: 'content.typeId', cases } as never),
      node({ key: 'on_news' }),
      node({ key: 'on_blog' }),
      node({ key: 'fallback' }),
      node({ key: 'after' }),
    ];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'pick'),
      edge('pick', 'news', 'on_news'),
      edge('pick', 'case_2', 'on_blog'),
      edge('pick', 'default', 'fallback'),
      edge('on_news', 'ok', 'after'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[0]).toMatchObject({
      key: 'pick',
      switch: {
        field: 'content.typeId',
        cases: [
          { id: 'news', label: 'News', value: 'news', then: 'on_news' },
          { id: 'case_2', operator: 'contains', value: 'blog', then: 'on_blog' },
          { id: 'case_3', value: 'x' },
        ],
      },
      else: 'fallback',
    });
    expect(graph.nodes[0]).toMatchObject({ kind: 'switch', cases });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips counted and repeated loops, and a stop', () => {
    const until = {
      match: 'any',
      rules: [{ field: 'nodes.page.next', operator: 'isEmpty', value: '' }],
    };
    const nodes = [
      node({
        key: 'times',
        kind: 'loop',
        mode: 'count',
        items: '',
        count: '{{ input.n }}',
        until: { match: 'all', rules: [] },
        maxItems: 20,
      } as never),
      node({ key: 'page' }),
      node({
        key: 'again',
        kind: 'loop',
        mode: 'until',
        items: '',
        count: '',
        until,
        maxItems: 5,
      } as never),
      node({ key: 'end', kind: 'stop', outcome: 'failed', message: 'done' } as never),
    ];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'times'),
      edge('times', 'each', 'page'),
      edge('times', 'done', 'again'),
      edge('again', 'done', 'end'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[0]).toMatchObject({
      loop: { times: '{{ input.n }}', maxItems: 20 },
      each: 'page',
    });
    expect(steps.find((step) => step.key === 'again')).toMatchObject({
      loop: { until, maxItems: 5 },
    });
    expect(steps.find((step) => step.key === 'end')).toMatchObject({
      stop: { outcome: 'failed', message: 'done' },
    });
    expect(graph.nodes.map((entry) => entry.kind)).toEqual(['loop', 'action', 'loop', 'stop']);
    expect(graph.nodes[0]).toMatchObject({ mode: 'count', count: '{{ input.n }}' });
    expect(graph.nodes[2]).toMatchObject({ mode: 'until', until });
    expect(graph.nodes[3]).toMatchObject({ outcome: 'failed', message: 'done' });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('round-trips an error port as the step it falls back to', () => {
    const nodes = [node({ key: 'send' }), node({ key: 'rescue' }), node({ key: 'after_send' })];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'send'),
      edge('send', 'error', 'rescue'),
      edge('send', 'ok', 'after_send'),
    ];

    const { steps, graph, unexpressed } = rebuild(nodes, edges);

    expect(unexpressed).toEqual([]);
    expect(steps[0]).toMatchObject({ key: 'send', onError: 'rescue' });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('keeps a node nothing reaches out of the chain rather than inventing an edge', () => {
    const nodes = [node({ key: 'first' }), node({ key: 'orphan' })];
    const edges = [edge(WORKFLOW_TRIGGER_ID, 'out', 'first')];

    const { steps, graph } = rebuild(nodes, edges);

    expect(steps[1]).toMatchObject({ key: 'orphan', after: null });
    expect(wiring(graph)).toEqual(wiring({ nodes, edges }));
  });

  it('names a credential by its slug and says so when it is gone', () => {
    const nodes = [
      node({ key: 'mail', credentialId: 'cred' }),
      node({ key: 'other', credentialId: 'lost' }),
    ];
    const edges = [edge(WORKFLOW_TRIGGER_ID, 'out', 'mail'), edge('mail', 'ok', 'other')];

    const { steps, unexpressed } = rebuild(nodes, edges);

    expect(steps[0]).toMatchObject({ credential: 'mailer' });
    expect(steps[1]).not.toHaveProperty('credential');
    expect(unexpressed).toEqual(['step other uses a credential this space no longer has']);
  });

  it('gives a node with no usable key one it can be addressed by', () => {
    const nodes = [node({ key: '', name: 'Send the mail' })];
    const edges = [edge(WORKFLOW_TRIGGER_ID, 'out', '')];

    const { steps } = stepsFromGraph(nodes, edges, options);

    expect(steps[0]?.key).toBe('send_the_mail');
  });
});

/** Renders admin-built workflows through the provider's config export, ids turned into refs. */
describe('workflows in the config export', () => {
  let ctx: ServiceContext;
  let config: SpaceConfigService;
  let credentialId: string;

  beforeAll(async () => {
    ctx = await createServiceContext('workflows_config_export', {
      fieldTypes: [],
      contentTypes: [{ name: 'article', fields: [] }],
      config: { plugins: [workflowsPlugin()] },
    });
    config = new SpaceConfigService(ctx.manablox, ctx.repos);
    const credential = await ctx.repos.credentials.create({
      spaceId: ctx.spaceId,
      name: 'Mailer',
      slug: 'mailer',
      kind: 'smtp',
      data: 'sealed',
    });
    credentialId = credential.id;
    const workflows = workflowRepos(ctx.repos).workflows;
    await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Notify on publish',
      enabled: true,
      trigger: {
        kind: 'event',
        events: ['content.published'],
        typeIds: [ctx.ids.article as string],
        locales: [],
      },
      nodes: [node({ key: 'mail', config: { to: 'editors@example.com' }, credentialId })],
      edges: [edge(WORKFLOW_TRIGGER_ID, 'out', 'mail')],
    });
    // Config-owned, so never rendered.
    await workflows.create({
      spaceId: ctx.spaceId,
      name: 'Declared',
      slug: 'declared',
      source: 'code',
      trigger: { kind: 'manual', parameters: [] },
      nodes: [],
      edges: [],
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('lists the workflows in the picker', async () => {
    const inventory = await config.inventory(ctx.spaceId);

    expect(inventory.plugins).toContainEqual({
      kind: 'workflows.workflow',
      label: 'Workflows',
      description: expect.any(String),
      icon: 'workflow',
      entries: [{ id: expect.any(String), label: 'Notify on publish' }],
    });
  });

  it('writes a workflow as defineWorkflow with keyed steps, ids as names', async () => {
    const { code, counts } = await config.source(ctx.spaceId);

    expect(counts).toMatchObject({ credentials: 1, 'workflows.workflow': 1 });
    expect(code).toContain("import { defineWorkflow } from '@manablox/plugin-workflows/define';");
    expect(code).toContain('export const notifyOnPublish = defineWorkflow({');
    expect(code).toContain("slug: 'notify-on-publish'");
    expect(code).toContain('enabled: true');
    expect(code).toContain("    'workflows.workflow': [notifyOnPublish],");
    // The credential by its slug, the content type as a reference.
    expect(code).toContain("credential: 'mailer'");
    expect(code).toContain("ref.contentType('article')");
    expect(code).not.toContain(ctx.ids.article as string);
    expect(code).not.toContain(credentialId);
    expect(code).not.toContain('Declared');
  });

  it('names the credential even when only the workflows are written', async () => {
    const { code, counts } = await config.source(ctx.spaceId, {
      kinds: ['workflows.workflow'],
    });

    expect(counts).toMatchObject({ 'workflows.workflow': 1, credentials: 0 });
    expect(code).toContain('defineWorkflow({');
    expect(code).not.toContain('defineCredential({');
    expect(code).toContain("credential: 'mailer'");
  });
});
