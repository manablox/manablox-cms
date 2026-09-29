import { ManabloxError } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_TRIGGER_ID,
  type WorkflowAbortTrigger,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowTrigger,
} from '../src/sdk.js';
import { builtinRegistry } from '../src/server/registry.js';
import { validateWorkflow, type WorkflowInput } from '../src/server/validate/index.js';
import { action, base, chain, edge as link } from './helpers/graph.js';

/** Validation never touches the database; the registry holds the built-in actions and kinds. */
const registry = builtinRegistry();

const env = {
  typeExists: (id: string) => id === 'page',
  credentialKind: (id: string) =>
    id === 'cred-bearer' ? ('bearer' as const) : id === 'cred-smtp' ? ('smtp' as const) : null,
  triggerData: () => undefined,
  workflowTrigger: (id: string): WorkflowTrigger | null =>
    id === 'wf-sub'
      ? {
          kind: 'call',
          parameters: [
            { name: 'orderId', description: '', required: true },
            { name: 'note', description: '', required: false },
          ],
          output: '',
        }
      : id === 'wf-event'
        ? { kind: 'event', events: ['content.saved'], typeIds: [], locales: [] }
        : null,
};

const email = (key = 'notify', config: Record<string, unknown> = {}): WorkflowNode =>
  action(key, 'email', {
    to: ['x@example.com'],
    toRoles: [],
    subject: 'Hi',
    body: '',
    html: false,
    ...config,
  });

const workflow = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowInput => ({
  name: 'Notify',
  trigger: { kind: 'event', events: ['content.saved'], typeIds: ['page'], locales: [] },
  nodes,
  edges,
});

/** A chain of nodes as a whole workflow input. */
const straight = (...nodes: WorkflowNode[]): WorkflowInput => {
  const built = chain(...nodes);
  return workflow(built.nodes, built.edges);
};

function problems(input: WorkflowInput): string[] {
  try {
    validateWorkflow(input, env, registry);
    return [];
  } catch (error) {
    if (!ManabloxError.is(error)) throw error;
    return error.details.map((detail) => `${detail.key}@${(detail.path ?? []).join('.')}`);
  }
}

describe('validateWorkflow', () => {
  it('passes a sound workflow and fills in the ids', () => {
    const input = straight(email());
    const blank = { ...input, edges: input.edges.map((edge) => ({ ...edge, id: '' })) };
    const out = validateWorkflow(blank, env, registry);
    expect(out.enabled).toBe(false);
    expect(out.edges[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reports every problem with its path', () => {
    expect(
      problems({
        name: ' ',
        trigger: { kind: 'event', events: [], typeIds: ['nope'], locales: [] },
        nodes: [],
        edges: [],
      }),
    ).toEqual([
      'plugins.workflows.name.required@name',
      'plugins.workflows.trigger.eventsRequired@trigger.events',
      'plugins.workflows.trigger.typeNotFound@trigger.typeIds.0',
      'plugins.workflows.nodes.required@nodes',
    ]);
  });

  it('checks a schedule', () => {
    const { nodes, edges } = chain(email());
    expect(
      problems({
        ...workflow(nodes, edges),
        trigger: {
          kind: 'schedule',
          cron: '* * *',
          timezone: 'Nowhere/Land',
          selection: null,
          perDocument: false,
        },
      }),
    ).toEqual([
      'plugins.workflows.trigger.cronInvalid@trigger.cron',
      'plugins.workflows.trigger.timezoneInvalid@trigger.timezone',
    ]);
  });

  it('refuses a trigger or abort trigger of a kind no configured plugin contributes', () => {
    const { nodes, edges } = chain(email());
    expect(
      problems({
        ...workflow(nodes, edges),
        trigger: { kind: 'webhook', webhookId: 'hook-in' } as unknown as WorkflowTrigger,
        abortTriggers: [
          {
            id: 'a1',
            kind: 'webhook',
            filter: null,
            match: { mode: 'all', runKey: '', abortKey: '' },
          } as unknown as WorkflowAbortTrigger,
        ],
      }),
    ).toEqual([
      'plugins.workflows.trigger.kindUnknown@trigger.kind',
      'plugins.workflows.abort.kindUnknown@abortTriggers.0.kind',
    ]);
  });

  it("hands an action's config to the action itself", () => {
    expect(problems(straight(email('notify', { to: [], subject: '' })))).toEqual([
      'plugins.workflows.node.email.recipientRequired@nodes.0.config.to',
      'plugins.workflows.node.email.subjectRequired@nodes.0.config.subject',
    ]);

    const unknown = email('call');
    (unknown as { action: string }).action = 'nope.missing';
    expect(problems(straight(unknown))).toEqual([
      'plugins.workflows.action.unknown@nodes.0.action',
    ]);
  });

  it('checks node keys', () => {
    const first = email('same');
    const second = email('same');
    const { edges } = chain(first, second);
    expect(problems(workflow([first, second], edges))).toEqual([
      'plugins.workflows.node.keyDuplicate@nodes.1.key',
    ]);

    expect(problems(straight(email('Not A Key')))).toEqual([
      'plugins.workflows.node.keyInvalid@nodes.0.key',
    ]);
  });

  it('refuses an edge that leaves a port the node does not have', () => {
    const node = email();
    expect(
      problems(
        workflow(
          [node],
          [link(WORKFLOW_TRIGGER_ID, node.id, 'out'), link(node.id, node.id, 'nope')],
        ),
      ),
    ).toEqual(['plugins.workflows.edge.selfLoop@edges.1.to']);

    const second = email('second');
    expect(
      problems(
        workflow(
          [node, second],
          [link(WORKFLOW_TRIGGER_ID, node.id, 'out'), link(node.id, second.id, 'maybe')],
        ),
      ),
    ).toEqual([
      'plugins.workflows.edge.portUnknown@edges.1.fromPort',
      'plugins.workflows.node.unreachable@nodes.1',
    ]);
  });

  it('refuses a cycle and an island', () => {
    const one = email('one');
    const two = email('two');
    expect(
      problems(
        workflow(
          [one, two],
          [link(WORKFLOW_TRIGGER_ID, one.id, 'out'), link(one.id, two.id), link(two.id, one.id)],
        ),
      ),
    ).toEqual(['plugins.workflows.graph.cycle@edges']);

    const island = email('island');
    const reachable = email('reachable');
    expect(
      problems(workflow([reachable, island], [link(WORKFLOW_TRIGGER_ID, reachable.id, 'out')])),
    ).toEqual(['plugins.workflows.node.unreachable@nodes.1']);
  });

  it('checks a credential against what the action accepts', () => {
    const node = email();
    (node as { credentialId: string | null }).credentialId = 'cred-smtp';
    // Email uses the instance mailer, so it takes no credential at all.
    expect(problems(workflow([node], [link(WORKFLOW_TRIGGER_ID, node.id, 'out')]))).toEqual([]);

    const call = {
      ...base('call'),
      kind: 'action' as const,
      action: 'mail.send',
      credentialId: 'cred-bearer',
      config: { to: ['x@example.com'], cc: [], subject: 'Hi', body: '', html: false, from: '' },
    } as WorkflowNode;
    expect(problems(workflow([call], [link(WORKFLOW_TRIGGER_ID, call.id, 'out')]))).toEqual([
      'plugins.workflows.action.credentialKind@nodes.0.credentialId',
    ]);

    const missing = { ...call, id: 'n-missing', credentialId: null } as WorkflowNode;
    expect(problems(workflow([missing], [link(WORKFLOW_TRIGGER_ID, missing.id, 'out')]))).toEqual([
      'plugins.workflows.action.credentialRequired@nodes.0.credentialId',
    ]);
  });

  it('refuses a reference to a node that is not upstream', () => {
    expect(
      problems(
        straight(email('first'), email('second', { subject: 'about {{ nodes.third.text }}' })),
      ),
    ).toEqual(['plugins.workflows.reference.unknownNode@nodes.1.config.subject']);

    expect(
      problems(straight(email('a', { subject: '{{ nodes.b.subject }}' }), email('b'))),
    ).toEqual(['plugins.workflows.reference.notUpstream@nodes.0.config.subject']);
  });
});

describe('loops', () => {
  const loop = (key: string, extra: Record<string, unknown> = {}): WorkflowNode =>
    ({
      ...base(key),
      kind: 'loop',
      items: '{{ nodes.first.to }}',
      maxItems: 10,
      ...extra,
    }) as WorkflowNode;
  const wait = (key: string): WorkflowNode =>
    ({ ...base(key), kind: 'delay', minutes: 5 }) as WorkflowNode;

  it('passes a branch that only starts from "each", and lets it read the item', () => {
    const first = email('first');
    const each = loop('each');
    const inside = email('inside', { subject: 'Hi {{ item }} ({{ loop.index }})' });
    const after = email('after', { subject: '{{ nodes.each.count }}' });
    expect(
      problems(
        workflow(
          [first, each, inside, after],
          [
            link(WORKFLOW_TRIGGER_ID, first.id, 'out'),
            link(first.id, each.id),
            link(each.id, inside.id, 'each'),
            link(each.id, after.id, 'done'),
          ],
        ),
      ),
    ).toEqual([]);
  });

  it('refuses a way into the branch from outside, a wait inside it, and an item outside it', () => {
    const first = email('first', { subject: '{{ item.title }}' });
    const each = loop('each', { maxItems: 0 });
    const inside = email('inside');
    const pause = wait('pause');
    expect(
      problems(
        workflow(
          [first, each, inside, pause],
          [
            link(WORKFLOW_TRIGGER_ID, first.id, 'out'),
            link(first.id, each.id),
            link(each.id, inside.id, 'each'),
            link(inside.id, pause.id),
            link(first.id, inside.id),
          ],
        ),
      ),
    ).toEqual([
      'plugins.workflows.node.loop.maxItemsInvalid@nodes.1.maxItems',
      'plugins.workflows.loop.enteredFromOutside@edges.4',
      'plugins.workflows.loop.waitInside@nodes.3',
      'plugins.workflows.reference.outsideLoop@nodes.0.config.subject',
    ]);
  });
});

describe('calls', () => {
  const call = (
    key: string,
    workflowId: string | null,
    input: Record<string, string> = {},
  ): WorkflowNode =>
    ({
      ...base(key),
      kind: 'call',
      workflowId,
      input: Object.entries(input).map(([name, value]) => ({ name, value })),
      wait: true,
    }) as WorkflowNode;

  it('passes a call with its required value, and reads its output later', () => {
    const run = call('order', 'wf-sub', { orderId: '{{ content.id }}' });
    const after = email('after', { subject: '{{ nodes.order.output.total }}' });
    expect(problems(straight(run, after))).toEqual([]);
  });

  it('refuses a missing, unknown or plain target and wrong values', () => {
    expect(problems(straight(call('none', null)))).toEqual([
      'plugins.workflows.call.targetRequired@nodes.0.workflowId',
    ]);
    expect(problems(straight(call('gone', 'wf-gone')))).toEqual([
      'plugins.workflows.call.targetNotFound@nodes.0.workflowId',
    ]);
    expect(problems(straight(call('plain', 'wf-event')))).toEqual([
      'plugins.workflows.call.targetNotCallable@nodes.0.workflowId',
    ]);
    expect(problems(straight(call('values', 'wf-sub', { orderId: ' ', extra: 'x' })))).toEqual([
      'plugins.workflows.call.inputUnknown@nodes.0.input.1.name',
      'plugins.workflows.call.inputRequired@nodes.0.input',
    ]);
  });

  it('checks a call trigger’s parameters and output', () => {
    const input: WorkflowInput = {
      ...straight(email()),
      trigger: {
        kind: 'call',
        parameters: [
          { name: 'orderId', description: '', required: true },
          { name: 'orderId', description: '', required: false },
          { name: '1st', description: '', required: false },
        ],
        output: '{{ nodes.missing.body }}',
      },
    };
    expect(problems(input)).toEqual([
      'plugins.workflows.trigger.parameterDuplicate@trigger.parameters.1.name',
      'plugins.workflows.trigger.parameterInvalid@trigger.parameters.2.name',
      'plugins.workflows.reference.unknownNode@trigger.output',
    ]);
  });

  it('checks a manual trigger’s parameters', () => {
    const input: WorkflowInput = {
      ...straight(email()),
      trigger: {
        kind: 'manual',
        parameters: [
          { name: 'note', description: ' Why ', required: false },
          { name: 'note', description: '', required: true },
        ],
      },
    };
    expect(problems(input)).toEqual([
      'plugins.workflows.trigger.parameterDuplicate@trigger.parameters.1.name',
    ]);
  });
});

describe('switches, repeats and stops', () => {
  const route = (key: string, cases: Array<Record<string, unknown>>, field = 'content.title') =>
    ({ ...base(key), kind: 'switch', field, cases }) as unknown as WorkflowNode;

  it('checks the value, the cases and their port names', () => {
    const pick = route(
      'pick',
      [
        { id: 'same', label: '', operator: 'equals', value: 'a' },
        { id: 'same', label: '', operator: 'equals', value: 'b' },
        { id: 'default', label: '', operator: 'equals', value: 'c' },
        { id: 'ok', label: '', operator: 'nearly', value: 'd' },
      ],
      '',
    );
    expect(problems(straight(pick))).toEqual([
      'plugins.workflows.node.switch.fieldRequired@nodes.0.field',
      'plugins.workflows.node.switch.caseIdDuplicate@nodes.0.cases.1.id',
      'plugins.workflows.node.switch.caseIdInvalid@nodes.0.cases.2.id',
      'plugins.workflows.rule.operatorUnknown@nodes.0.cases.3.operator',
    ]);
    expect(problems(straight(route('empty', [])))).toEqual([
      'plugins.workflows.node.switch.casesRequired@nodes.0.cases',
    ]);
  });

  it('asks a counted loop for its count and lets repeat rules read its own branch', () => {
    const loop = (key: string, extra: Record<string, unknown>): WorkflowNode =>
      ({
        ...base(key),
        kind: 'loop',
        mode: 'items',
        items: '',
        count: '',
        until: { match: 'all', rules: [] },
        maxItems: 10,
        ...extra,
      }) as WorkflowNode;
    const times = loop('times', { mode: 'count' });
    const again = loop('again', {
      mode: 'until',
      until: {
        match: 'all',
        rules: [{ field: 'loop.index', operator: 'equals', value: '{{ nodes.inside.subject }}' }],
      },
    });
    const inside = email('inside');
    expect(
      problems(
        workflow(
          [times, again, inside],
          [
            link(WORKFLOW_TRIGGER_ID, times.id, 'out'),
            link(times.id, again.id, 'done'),
            link(again.id, inside.id, 'each'),
          ],
        ),
      ),
    ).toEqual(['plugins.workflows.node.loop.countRequired@nodes.0.count']);
    expect(problems(straight(loop('bare', { mode: 'until' })))).toEqual([
      'plugins.workflows.node.condition.rulesRequired@nodes.0.until.rules',
    ]);
  });

  it('lets nothing follow a stop', () => {
    const end = { ...base('end'), kind: 'stop', outcome: 'succeeded', message: '' } as WorkflowNode;
    const after = email('after');
    expect(
      problems(
        workflow(
          [end, after],
          [link(WORKFLOW_TRIGGER_ID, end.id, 'out'), link(end.id, after.id, 'ok')],
        ),
      ),
    ).toEqual([
      'plugins.workflows.edge.portUnknown@edges.1.fromPort',
      'plugins.workflows.node.unreachable@nodes.1',
    ]);
  });
});
