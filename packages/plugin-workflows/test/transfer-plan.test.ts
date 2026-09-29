import { describe, expect, it } from 'vitest';
import type { WorkflowEdge, WorkflowNode, WorkflowSnapshot, WorkflowTrigger } from '../src/sdk.js';
import { builtinRegistry } from '../src/server/registry.js';
import {
  planImport,
  readSpaceWorkflows,
  type WorkflowFile,
  type WorkflowImportSource,
  type WorkflowImportSpaceRows,
} from '../src/server/transfer/index.js';
import { base, called } from './helpers/graph.js';

/** Ids equal keys, so remapped ids read `kind:key`. */
const node = (key: string, rest: Record<string, unknown>) =>
  ({ ...base(key), id: key, ...rest }) as unknown as WorkflowNode;
const http = (key: string, credentialId: string | null) =>
  node(key, {
    kind: 'action',
    action: 'http',
    config: { url: 'https://api.test' },
    credentialId,
  });
const call = (key: string, workflowId: string) =>
  node(key, { kind: 'call', workflowId, input: [], wait: true });

const noEdges: WorkflowEdge[] = [];
const callTrigger = called();
const snapshot = (
  name: string,
  nodes: WorkflowNode[],
  trigger: WorkflowTrigger = callTrigger,
): WorkflowSnapshot => ({
  name,
  description: null,
  trigger,
  abortTriggers: [],
  nodes,
  edges: noEdges,
});

const emptySpace: WorkflowImportSpaceRows = { credentials: [], records: {}, workflows: [] };
const options = {
  registry: builtinRegistry(),
  typeExists: (typeId: string) => typeId === 'page',
  newId: (kind: string, id: string) => `${kind}:${id}`,
};

const source = (partial: Partial<WorkflowImportSource>): WorkflowImportSource => ({
  workflows: [],
  credentials: [],
  records: {},
  called: [],
  ...partial,
});
const entry = (id: string, draft: WorkflowSnapshot, live: WorkflowSnapshot | null = null) => ({
  id,
  draft,
  live,
  enabled: true,
  publish: true,
});

describe('planImport', () => {
  it('renames workflows whose names are taken, in the space and within the import', () => {
    const plan = planImport(
      source({
        workflows: [
          entry('a', snapshot('Ship', [])),
          entry('b', snapshot('Ship', [])),
          entry('c', snapshot('  ', [])),
        ],
      }),
      {
        ...emptySpace,
        workflows: [{ id: 'w1', name: 'Ship', slug: '', trigger: callTrigger }],
      },
      options,
    );
    expect(plan.workflows.map((row) => row.draft.name)).toEqual([
      'Ship (copy)',
      'Ship (copy 2)',
      'Imported workflow',
    ]);
    expect(plan.workflows.map((row) => row.id)).toEqual(['workflow:a', 'workflow:b', 'workflow:c']);
    expect(plan.notes).toEqual([]);
  });

  it('reuses a credential of the same slug and kind, creates the rest', () => {
    const plan = planImport(
      source({
        workflows: [
          entry(
            'a',
            snapshot('Sync', [
              http('one', 'f-stripe'),
              http('two', 'f-mail'),
              http('three', 'f-key'),
            ]),
          ),
        ],
        credentials: [
          { id: 'f-stripe', name: 'Stripe', slug: 'stripe', kind: 'bearer', provider: '' },
          { id: 'f-mail', name: 'Mail', slug: 'mail', kind: 'basic', provider: '' },
          { id: 'f-key', name: 'Key', slug: 'key', kind: 'bearer', provider: '' },
          { id: 'f-unused', name: 'Unused', slug: 'unused', kind: 'bearer', provider: '' },
        ],
      }),
      {
        ...emptySpace,
        credentials: [
          { id: 'stripe-here', slug: 'stripe', kind: 'bearer' },
          { id: 'key-here', slug: 'key', kind: 'apiKey' },
        ],
      },
      options,
    );

    expect(plan.credentials.map((row) => [row.id, row.slug])).toEqual([
      ['credential:f-mail', 'mail'],
      ['credential:f-key', 'key-2'],
    ]);
    const nodes = plan.workflows[0]?.draft.nodes as Array<{ credentialId: string }>;
    expect(nodes.map((row) => row.credentialId)).toEqual([
      'stripe-here',
      'credential:f-mail',
      'credential:f-key',
    ]);
    expect(plan.notes).toEqual([
      'Created the credential "Mail"; fill in its secret.',
      'The credential "key" exists here as a different kind; created "key-2", fill in its secret.',
    ]);
  });

  it('wires call nodes to workflows of the same import and to called ones in the space', () => {
    const plan = planImport(
      source({
        workflows: [
          entry(
            'parent',
            snapshot('Parent', [call('child', 'child'), call('shared', 'f-shared')]),
            snapshot('Parent', [call('child', 'child')]),
          ),
          entry('child', snapshot('Child', [call('stray', 'nowhere')])),
        ],
        called: [{ id: 'f-shared', name: 'Shared', slug: 'shared-flow' }],
      }),
      {
        ...emptySpace,
        workflows: [
          { id: 'by-name', name: 'Shared', slug: '', trigger: callTrigger },
          { id: 'by-slug', name: 'Other', slug: 'shared-flow', trigger: callTrigger },
        ],
      },
      options,
    );

    const [parent, child] = plan.workflows;
    const targets = (nodes: WorkflowNode[] | undefined) =>
      (nodes as Array<{ workflowId: string | null }>).map((row) => row.workflowId);
    expect(targets(parent?.draft.nodes)).toEqual(['workflow:child', 'by-slug']);
    expect(targets(parent?.live?.nodes)).toEqual(['workflow:child']);
    expect(targets(child?.draft.nodes)).toEqual([null]);
    expect(parent).toMatchObject({ enabled: true, publish: true, missingCallTarget: false });
    expect(child).toMatchObject({ enabled: false, publish: false, missingCallTarget: true });
    expect(plan.notes).toEqual([
      'The node "stray" needs a workflow to call.',
      'Imported "Child" switched off and unpublished: a workflow it runs is not in this space.',
    ]);
    expect(plan.ids.workflow.get('parent')).toBe('workflow:parent');
  });

  it('switches off a workflow whose called workflow the space lacks, and plans the rest', () => {
    const plan = planImport(
      source({
        workflows: [
          entry('a', snapshot('A', [call('go', 'f-x')]), snapshot('A', [call('go', 'f-x')])),
          entry('b', snapshot('B', [])),
        ],
        called: [{ id: 'f-x', name: 'Missing', slug: '' }],
      }),
      emptySpace,
      options,
    );
    const [a, b] = plan.workflows;
    expect(a).toMatchObject({
      enabled: false,
      publish: false,
      live: null,
      missingCallTarget: true,
    });
    expect(a?.draft.nodes).toEqual([expect.objectContaining({ key: 'go', workflowId: null })]);
    expect(b).toMatchObject({ enabled: true, publish: true, missingCallTarget: false });
    expect(plan.notes).toContain(
      'Imported "A" switched off and unpublished: the workflow "Missing" it runs is not in this space.',
    );
  });

  it('reads a workflow file as one disabled, unpublished workflow', () => {
    const file: WorkflowFile = {
      format: 'manablox.workflow',
      version: 1,
      exportedAt: '',
      workflow: snapshot('Solo', []),
      credentials: [],
      workflows: [],
    };
    const [planned] = planImport(file, emptySpace, options).workflows;
    expect(planned).toMatchObject({ enabled: false, publish: false, live: null });
  });
});

describe('readSpaceWorkflows', () => {
  it('reads a workflow without a live version and the call targets beside it', () => {
    const read = readSpaceWorkflows(
      [
        {
          id: 'w1',
          name: 'Old',
          description: null,
          enabled: true,
          trigger: callTrigger,
          abortTriggers: [],
          nodes: [],
          edges: [],
          published: true,
        },
        { id: 'f-shared', name: 'Shared', slug: 'shared' },
      ],
      options.registry,
    );
    expect(read.workflows).toEqual([
      {
        id: 'w1',
        draft: expect.objectContaining({ name: 'Old', abortTriggers: [] }),
        live: null,
        enabled: true,
        publish: true,
      },
    ]);
    // Without the file's credentials and endpoints, nothing to recreate.
    expect(read).toMatchObject({ credentials: [], records: {} });
    expect(read.called).toEqual([{ id: 'f-shared', name: 'Shared', slug: 'shared' }]);
  });
});
