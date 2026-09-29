import { defineContentType } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { WORKFLOW_NODE_KINDS, WORKFLOW_TRIGGER_ID, WORKFLOW_TRIGGER_KINDS } from '../src/sdk.js';
import { readWorkflowDesign } from '../src/server/design.js';
import {
  composeWorkflowDesignPrompt,
  type WorkflowDesignContext,
} from '../src/server/design-prompt.js';
import { builtinRegistry } from '../src/server/registry.js';
import type { WorkflowCatalog } from '../src/server/services/workflow.service.js';

let context: WorkflowDesignContext;

const article = defineContentType({
  name: 'article',
  spaceId: 'space',
  fields: [{ name: 'category', type: 'string' }],
});

const env = {
  typeExists: (id: string) => id === article.id,
  credentialKind: (id: string) => (id === 'cred-bearer' ? ('bearer' as const) : null),
  triggerData: () => undefined,
  workflowTrigger: (id: string) =>
    id === 'wf-summary'
      ? {
          kind: 'call' as const,
          parameters: [{ name: 'text', description: '', required: true }],
          output: '',
        }
      : null,
};

beforeAll(() => {
  // Design never touches the database; the registry holds the built-in actions and kinds.
  const registry = builtinRegistry();
  // An instance without a mailer: what the actions' availability reads.
  const manablox = new Manablox({
    database: { url: 'postgres://unused/unused' },
    auth: { secret: 'test-secret' },
  });
  context = {
    registry,
    catalog: {
      actions: registry.actions.catalog(manablox),
      credentials: [{ id: 'cred-bearer', name: 'Slack token', slug: 'slack', kind: 'bearer' }],
      triggers: {},
      callable: [
        {
          id: 'wf-summary',
          name: 'Summarise',
          enabled: true,
          parameters: [{ name: 'text', description: '', required: true }],
        },
      ],
    } as unknown as WorkflowCatalog,
    contentTypes: [article],
  };
});

const answer = {
  name: 'Tell the desk about news',
  description: 'Mails the desk when a news article goes live.',
  trigger: { kind: 'event', events: ['content.published'], types: ['article'], locales: [] },
  steps: [
    {
      key: 'is_news',
      kind: 'condition',
      match: 'all',
      rules: [{ field: 'content.fields.category', operator: 'equals', value: 'news' }],
      after: [{ step: 'trigger', port: 'out' }],
    },
    {
      key: 'notify',
      kind: 'action',
      action: 'email',
      config: { to: ['desk@example.com'], subject: 'New: {{ content.title }}' },
      after: [{ step: 'is_news', port: 'true' }],
    },
    {
      key: 'ping',
      kind: 'action',
      action: 'http',
      credential: 'Slack token',
      config: { method: 'POST', url: 'https://hooks.example.com/desk' },
      after: ['notify'],
    },
  ],
  notes: 'Fill in the desk address.',
};

describe('designing a workflow', () => {
  it("shows the model the space's actions, credentials and types", () => {
    const prompt = composeWorkflowDesignPrompt('Mail the desk', context);
    // Only what this instance can run: no mailer here, so no email action.
    expect(prompt).toContain('"http" (Call an API)');
    expect(prompt).not.toContain('"email"');
    expect(prompt).toContain('"Slack token" (bearer)');
    expect(prompt).toContain('"article" (Article): category (string)');
  });

  it('turns keyed steps into a valid graph, names resolved to ids', () => {
    const { value, problems } = readWorkflowDesign(answer, context, env);
    expect(problems).toEqual([]);

    const { workflow } = value;
    expect(workflow.enabled).toBe(false);
    expect(workflow.trigger).toEqual({
      kind: 'event',
      events: ['content.published'],
      typeIds: [article.id],
      locales: [],
    });
    const [condition, notify, ping] = workflow.nodes;
    expect(notify).toMatchObject({ kind: 'action', action: 'email', key: 'notify' });
    // The action's defaults are under what the model wrote.
    expect(notify?.kind === 'action' && notify.config).toMatchObject({ html: false, toRoles: [] });
    expect(ping?.kind === 'action' && ping.credentialId).toBe('cred-bearer');
    expect(workflow.edges.map((edge) => [edge.from, edge.fromPort, edge.to])).toEqual([
      [WORKFLOW_TRIGGER_ID, 'out', condition?.id],
      [condition?.id, 'true', notify?.id],
      // A bare key follows the action's `ok`.
      [notify?.id, 'ok', ping?.id],
    ]);
    // Laid out a row per step, down from the trigger.
    expect(workflow.nodes.map((node) => node.ui.y)).toEqual([176, 352, 528]);
    expect(value.notes).toBe('Fill in the desk address.');
  });

  it('reads keyValue fields written as key rows or as a plain object', () => {
    const { value, problems } = readWorkflowDesign(
      {
        ...answer,
        steps: [
          {
            key: 'write',
            kind: 'action',
            action: 'content.create',
            config: {
              typeId: 'article',
              title: 'From {{ content.title }}',
              fields: [{ key: 'category', value: 'news' }, { value: 'no name' }],
            },
          },
          {
            key: 'ping',
            kind: 'action',
            action: 'http',
            config: { url: 'https://hooks.example.com', headers: { 'x-count': 3 } },
            after: ['write'],
          },
        ],
      },
      context,
      env,
    );
    expect(problems).toEqual([]);
    const [write, ping] = value.workflow.nodes as Array<{ config: Record<string, unknown> }>;
    expect(write?.config.fields).toEqual([
      { name: 'category', value: 'news' },
      { name: '', value: 'no name' },
    ]);
    expect(ping?.config.headers).toEqual([{ name: 'x-count', value: '3' }]);
  });

  it('reads a loop, a step linked to it without a port running per item', () => {
    const { value, problems } = readWorkflowDesign(
      {
        ...answer,
        steps: [
          {
            key: 'fetch',
            kind: 'action',
            action: 'http',
            config: { method: 'GET', url: 'https://feeds.example.com/news' },
          },
          {
            key: 'each_story',
            kind: 'loop',
            items: '{{ nodes.fetch.body.items }}',
            maxItems: 900,
            after: ['fetch'],
          },
          {
            key: 'ping',
            kind: 'action',
            action: 'http',
            config: { url: 'https://hooks.example.com/{{ item.id }}' },
            after: ['each_story'],
          },
        ],
      },
      context,
      env,
    );
    expect(problems).toEqual([]);
    const loop = value.workflow.nodes.find((node) => node.key === 'each_story');
    expect(loop).toMatchObject({ kind: 'loop', maxItems: 500 });
    expect(value.workflow.edges.find((edge) => edge.from === loop?.id)?.fromPort).toBe('each');
  });

  it("reports what a save would refuse, in terms of the model's own steps", () => {
    const { problems } = readWorkflowDesign(
      {
        ...answer,
        trigger: { kind: 'webhook', webhook: 'Payments' },
        steps: [
          { key: 'fetch', kind: 'action', action: 'http', config: { url: '' } },
          { key: 'orphan', kind: 'delay', minutes: 5 },
          { key: 'mail', kind: 'action', action: 'fax', after: [{ step: 'nowhere' }] },
        ],
      },
      context,
      env,
    );
    const text = problems.join('\n');
    // No configured plugin contributes the kind.
    expect(text).toMatch(/"trigger" must have "kind" event, schedule, call, manual/);
    expect(text).toMatch(/"fax", which does not exist/);
    expect(text).toMatch(/follows "nowhere", which is not a step/);
    expect(text).toMatch(/Step "fetch"/);
    expect(text).toMatch(/Step "orphan"/);
  });

  it('describes every node kind and trigger kind', () => {
    const prompt = composeWorkflowDesignPrompt('Anything', context);
    for (const kind of [...WORKFLOW_NODE_KINDS, ...WORKFLOW_TRIGGER_KINDS]) {
      expect(prompt).toContain(`"kind": "${kind}"`);
    }
    expect(prompt).toContain('"abortTriggers"');
    expect(prompt).toContain('"Summarise" (input: text (required))');
  });

  it('reads a call step, a call trigger and an abort trigger', () => {
    const { value, problems } = readWorkflowDesign(
      {
        name: 'Summarise and pass on',
        trigger: {
          kind: 'call',
          parameters: [{ name: 'orderId', description: 'The order', required: true }],
          output: '{{ nodes.summary.output }}',
        },
        abortTriggers: [
          {
            kind: 'event',
            events: ['content.published'],
            types: ['article'],
            match: { runKey: '{{ input.orderId }}', abortKey: '{{ content.fields.order }}' },
          },
          { kind: 'event', events: ['content.deleted'], types: ['article'], match: 'document' },
        ],
        steps: [
          {
            key: 'summary',
            kind: 'call',
            workflow: 'Summarise',
            input: { text: 'Order {{ input.orderId }}' },
            wait: true,
          },
          {
            key: 'ping',
            kind: 'action',
            action: 'http',
            config: { url: 'https://hooks.example.com/{{ nodes.summary.output }}' },
            after: [{ step: 'summary', port: 'ok' }],
          },
        ],
      },
      context,
      env,
    );
    expect(problems).toEqual([]);
    const { workflow } = value;
    expect(workflow.trigger).toEqual({
      kind: 'call',
      parameters: [{ name: 'orderId', description: 'The order', required: true }],
      output: '{{ nodes.summary.output }}',
    });
    expect(workflow.abortTriggers).toMatchObject([
      {
        kind: 'event',
        events: ['content.published'],
        typeIds: [article.id],
        match: {
          mode: 'key',
          runKey: '{{ input.orderId }}',
          abortKey: '{{ content.fields.order }}',
        },
      },
      {
        kind: 'event',
        events: ['content.deleted'],
        typeIds: [article.id],
        match: { mode: 'document' },
      },
    ]);
    const [summary, ping] = workflow.nodes;
    expect(summary).toMatchObject({
      kind: 'call',
      workflowId: 'wf-summary',
      input: [{ name: 'text', value: 'Order {{ input.orderId }}' }],
      wait: true,
    });
    expect(workflow.edges.map((edge) => [edge.from, edge.fromPort, edge.to])).toEqual([
      [WORKFLOW_TRIGGER_ID, 'out', summary?.id],
      [summary?.id, 'ok', ping?.id],
    ]);
  });

  it('reports a call step naming a workflow it cannot run', () => {
    const { problems } = readWorkflowDesign(
      {
        ...answer,
        steps: [{ key: 'summary', kind: 'call', workflow: 'Nowhere', input: {} }],
      },
      context,
      env,
    );
    expect(problems.join('\n')).toMatch(/runs the workflow "Nowhere", which cannot be run/);
  });
});
