import { defineContentType } from '@manablox/core';
import { Manablox } from '@manablox/core/node';
import {
  builtinContributions,
  composeWorkflowDesignPrompt,
  readWorkflowDesign,
  type WorkflowCatalog,
  type WorkflowDesignContext,
  WorkflowRegistry,
} from '@manablox/plugin-workflows';
import { beforeAll, describe, expect, it } from 'vitest';
import { webhookTriggerKinds } from '../src/server/triggers.js';

let context: WorkflowDesignContext;

const article = defineContentType({ name: 'article', spaceId: 'space', fields: [] });

/** Validation's view of the space: one incoming endpoint, `hook-in`. */
const env = {
  typeExists: (id: string) => id === article.id,
  credentialKind: () => null,
  triggerData: (kind: string) => (kind === 'webhook' ? new Set(['hook-in']) : undefined),
  workflowTrigger: () => null,
};

beforeAll(() => {
  // Design never touches the database; the registry holds the built-ins and the webhook kinds.
  const own = <T>(plugin: string, entries: readonly T[]) =>
    entries.map((entry) => ({ plugin, entry }));
  const builtins = builtinContributions();
  const kinds = webhookTriggerKinds();
  const registry = new WorkflowRegistry({
    actions: own('workflows', builtins.actions),
    triggers: [...own('workflows', builtins.triggers), ...own('webhooks', [kinds.trigger])],
    abortTriggers: [...own('workflows', builtins.abortTriggers), ...own('webhooks', [kinds.abort])],
    fieldKinds: [],
    designHints: [],
  });
  const manablox = new Manablox({
    database: { url: 'postgres://unused/unused' },
    auth: { secret: 'test-secret' },
  });
  context = {
    registry,
    catalog: {
      actions: registry.actions.catalog(manablox),
      credentials: [],
      triggers: { webhook: [{ id: 'hook-in', name: 'Orders', slug: 'orders' }] },
      callable: [],
    } as unknown as WorkflowCatalog,
    contentTypes: [article],
  };
});

const steps = [{ key: 'ping', kind: 'action', action: 'http', config: { url: 'https://x.test' } }];

describe('designing a webhook workflow', () => {
  it('shows the model the incoming endpoints by name', () => {
    const prompt = composeWorkflowDesignPrompt('On an order', context);
    expect(prompt).toContain('"kind": "webhook"');
    expect(prompt).toContain('Incoming webhooks, by name: "Orders"');

    const none = composeWorkflowDesignPrompt('On an order', {
      ...context,
      catalog: { ...context.catalog, triggers: { webhook: [] } },
    });
    expect(none).toContain('A webhook trigger is not possible');
  });

  it('resolves the endpoint a trigger names, and keeps its filter', () => {
    const { value, problems } = readWorkflowDesign(
      {
        name: 'On an order',
        trigger: {
          kind: 'webhook',
          webhook: 'orders',
          filter: { rules: [{ field: 'payload.body.paid', operator: 'equals', value: 'yes' }] },
        },
        steps,
      },
      context,
      env,
    );
    expect(problems).toEqual([]);
    expect(value.workflow.trigger).toMatchObject({
      kind: 'webhook',
      webhookId: 'hook-in',
      filter: { rules: [expect.objectContaining({ field: 'payload.body.paid' })] },
    });
  });

  it("reports an endpoint the space lacks, in the model's terms", () => {
    const { problems } = readWorkflowDesign(
      { name: 'x', trigger: { kind: 'webhook', webhook: 'Payments' }, steps },
      context,
      env,
    );
    expect(problems.join('\n')).toMatch(/no incoming webhook "Payments"/);
  });

  it('reads an abort trigger on an endpoint', () => {
    const { value, problems } = readWorkflowDesign(
      {
        name: 'Remind',
        trigger: { kind: 'event', events: ['content.published'], types: ['article'] },
        abortTriggers: [
          {
            kind: 'webhook',
            webhook: 'Orders',
            match: { runKey: '{{ content.id }}', abortKey: '{{ payload.body.id }}' },
          },
        ],
        steps,
      },
      context,
      env,
    );
    expect(problems).toEqual([]);
    expect(value.workflow.abortTriggers).toMatchObject([
      {
        kind: 'webhook',
        webhookId: 'hook-in',
        match: { mode: 'key', runKey: '{{ content.id }}', abortKey: '{{ payload.body.id }}' },
      },
    ]);
  });
});
