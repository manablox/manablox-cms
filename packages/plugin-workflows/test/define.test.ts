import { ref } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import {
  type CodeWorkflowAbortTrigger,
  type CodeWorkflowTrigger,
  defineWorkflow,
  WORKFLOW_TRIGGER_ID,
} from '../src/define.js';

const edge = (
  graph: { edges: Array<{ from: string; fromPort: string; to: string }> },
  to: string,
) => graph.edges.filter((candidate) => candidate.to === to);

describe('defineWorkflow', () => {
  it('chains steps in declaration order, starting at the trigger', () => {
    const workflow = defineWorkflow({
      slug: 'notify',
      trigger: { kind: 'event', events: ['content.published'] },
      steps: [
        { key: 'summarise', action: 'ai.generate' },
        { key: 'notify', action: 'email', credential: 'mailer' },
      ],
    });

    const [summarise, notify] = workflow.graph.nodes;
    expect(workflow.graph.edges).toHaveLength(2);
    expect(edge(workflow.graph, summarise!.id)[0]).toMatchObject({
      from: WORKFLOW_TRIGGER_ID,
      fromPort: 'out',
    });
    expect(edge(workflow.graph, notify!.id)[0]).toMatchObject({
      from: summarise!.id,
      fromPort: 'ok',
    });
    expect(notify).toMatchObject({ credentialId: ref.credential('mailer') });
  });

  it('is stable across calls, so a run log still names its nodes', () => {
    const build = () =>
      defineWorkflow({
        slug: 'notify',
        trigger: { kind: 'event', events: ['content.published'] },
        steps: [{ key: 'notify', action: 'email' }],
      });
    expect(build().graph).toEqual(build().graph);
  });

  it('branches a condition and leaves its targets off the chain', () => {
    const workflow = defineWorkflow({
      slug: 'gate',
      trigger: { kind: 'event', events: ['content.saved'] },
      steps: [
        { key: 'check', condition: { rules: [] }, then: 'yes', else: 'no' },
        { key: 'yes', action: 'email' },
        { key: 'no', action: 'http' },
      ],
    });

    const byKey = new Map(workflow.graph.nodes.map((node) => [node.key, node.id]));
    expect(edge(workflow.graph, byKey.get('yes') as string)).toEqual([
      expect.objectContaining({ from: byKey.get('check'), fromPort: 'true' }),
    ]);
    expect(edge(workflow.graph, byKey.get('no') as string)).toEqual([
      expect.objectContaining({ from: byKey.get('check'), fromPort: 'false' }),
    ]);
  });

  it('routes a failure through onError', () => {
    const workflow = defineWorkflow({
      slug: 'call',
      trigger: { kind: 'event', events: ['content.saved'] },
      steps: [
        { key: 'call', action: 'http', onError: 'tell' },
        { key: 'tell', action: 'email' },
      ],
    });
    const byKey = new Map(workflow.graph.nodes.map((node) => [node.key, node.id]));
    expect(edge(workflow.graph, byKey.get('tell') as string)).toEqual([
      expect.objectContaining({ from: byKey.get('call'), fromPort: 'error' }),
    ]);
  });

  it('joins two branches with an explicit after', () => {
    const workflow = defineWorkflow({
      slug: 'fork',
      trigger: { kind: 'event', events: ['content.saved'] },
      steps: [
        { key: 'a', action: 'http' },
        { key: 'b', action: 'http', after: WORKFLOW_TRIGGER_ID },
        { key: 'join', action: 'email', after: ['a', 'b'], join: 'all' },
      ],
    });
    const byKey = new Map(workflow.graph.nodes.map((node) => [node.key, node.id]));
    expect(edge(workflow.graph, byKey.get('join') as string)).toHaveLength(2);
    expect(workflow.graph.nodes.find((node) => node.key === 'join')?.join).toBe('all');
  });

  it('lays the graph out in columns, so it opens readable', () => {
    const workflow = defineWorkflow({
      slug: 'gate',
      trigger: { kind: 'event', events: ['content.saved'] },
      steps: [
        { key: 'check', condition: { rules: [] }, then: 'yes', else: 'no' },
        { key: 'yes', action: 'email' },
        { key: 'no', action: 'http' },
      ],
    });
    const at = (key: string) => workflow.graph.nodes.find((node) => node.key === key)?.ui;
    expect(at('check')?.x).toBeLessThan(at('yes')?.x as number);
    expect(at('yes')?.y).not.toBe(at('no')?.y);
  });

  it('keeps the trigger of a contributed kind as its plugin built it', () => {
    // E.g. `webhookTrigger('github-push')` of `@manablox/plugin-webhooks/define`.
    const trigger = { kind: 'acme.order', orderType: ref.of('acme.shop', 'eu'), filter: null };
    const workflow = defineWorkflow({
      slug: 'on-order',
      trigger: trigger as unknown as CodeWorkflowTrigger,
      abortOn: [
        {
          kind: 'acme.order',
          orderType: ref.of('acme.shop', 'eu'),
          match: { key: { run: '{{ payload.id }}', abort: '{{ payload.id }}' } },
        } as unknown as CodeWorkflowAbortTrigger,
      ],
      steps: [{ key: 'go', action: 'http' }],
    });
    expect(workflow.trigger).toEqual(trigger);
    expect(workflow.abortTriggers).toEqual([
      {
        id: expect.any(String),
        kind: 'acme.order',
        orderType: ref.of('acme.shop', 'eu'),
        filter: null,
        match: { mode: 'key', runKey: '{{ payload.id }}', abortKey: '{{ payload.id }}' },
      },
    ]);
  });

  it("fills a manual trigger's parameters, a bare name as an optional one", () => {
    const workflow = defineWorkflow({
      slug: 'reindex',
      trigger: { kind: 'manual', parameters: ['note', { name: 'typeId', required: true }] },
      steps: [{ key: 'go', action: 'http' }],
    });
    expect(workflow.trigger).toEqual({
      kind: 'manual',
      parameters: [
        { name: 'note', description: '', required: false },
        { name: 'typeId', description: '', required: true },
      ],
    });
  });

  it('refuses a graph it cannot wire', () => {
    const trigger: CodeWorkflowTrigger = { kind: 'event', events: ['content.saved'] };
    expect(() => defineWorkflow({ slug: 'Bad Slug', trigger, steps: [] })).toThrow(
      /codeResource.slug.invalid/,
    );
    expect(() => defineWorkflow({ slug: 'empty', trigger, steps: [] })).toThrow(
      /plugins.workflows.code.steps.required/,
    );
    expect(() =>
      defineWorkflow({
        slug: 'dupe',
        trigger,
        steps: [
          { key: 'a', action: 'http' },
          { key: 'a', action: 'http' },
        ],
      }),
    ).toThrow(/keyDuplicate/);
    expect(() =>
      defineWorkflow({
        slug: 'gone',
        trigger,
        steps: [{ key: 'a', action: 'http', onError: 'b' }],
      }),
    ).toThrow(/targetUnknown/);
    expect(() =>
      defineWorkflow({
        slug: 'ambiguous',
        trigger,
        steps: [
          { key: 'check', condition: { rules: [] } },
          { key: 'after', action: 'http' },
        ],
      }),
    ).toThrow(/portRequired/);
  });
});
