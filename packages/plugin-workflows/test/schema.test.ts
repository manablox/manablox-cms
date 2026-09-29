import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { workflowBodyShape, workflowFileSchema } from '../src/schema.js';

const body = z.object(workflowBodyShape);

describe('workflow schemas', () => {
  it('fills the defaults of a sparse graph, a contributed trigger kind as it came', () => {
    const parsed = body.parse({
      name: 'Hook',
      trigger: { kind: 'webhook', webhookId: ids.webhook },
      nodes: [{ kind: 'condition', rules: [{ field: 'a', operator: 'equals' }] }],
      edges: [{ from: 'trigger', fromPort: 'out', to: 'n1', guard: { rules: [] } }],
    });
    // Its kind's `check` reads and normalises the rest.
    expect(parsed.trigger).toEqual({ kind: 'webhook', webhookId: ids.webhook });
    expect(parsed.abortTriggers).toEqual([]);
    expect(parsed.nodes[0]).toMatchObject({
      enabled: true,
      join: 'any',
      match: 'all',
      rules: [{ field: 'a', operator: 'equals', value: '' }],
    });
    expect(parsed.edges[0]?.guard).toEqual({ match: 'all', rules: [] });
  });

  it('takes uuids for references in a space and file-local ids in a file', () => {
    const graph = {
      name: 'Hook',
      trigger: { kind: 'webhook', webhookId: 'w1' },
      abortTriggers: [{ kind: 'webhook', webhookId: 'w1' }],
      nodes: [{ kind: 'call', workflowId: 'wf1' }],
      edges: [],
    };
    expect(body.safeParse(graph).success).toBe(false);
    const file = workflowFileSchema.parse({
      format: 'manablox.workflow',
      version: 1,
      workflow: graph,
    });
    expect(file.workflow.nodes[0]).toMatchObject({ kind: 'call', workflowId: 'wf1', wait: true });
    expect(file.credentials).toEqual([]);
  });
});
