import { describe, expect, it } from 'vitest';
import {
  readWorkflowNode,
  snapWorkflowPosition,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_NODE_SPECS,
  WORKFLOW_TRIGGER_KINDS,
  WORKFLOW_TRIGGER_SPECS,
  type WorkflowNode,
  workflowNodeLabel,
  workflowNodePorts,
} from '../src/sdk.js';

describe('workflow node specs', () => {
  it('names only ports each kind has', () => {
    for (const kind of WORKFLOW_NODE_KINDS) {
      const spec = WORKFLOW_NODE_SPECS[kind];
      const ports = workflowNodePorts({ kind, cases: [] } as unknown as WorkflowNode).map(
        (port) => port.name,
      );
      // Nothing leaves a stop.
      if (kind === 'stop') {
        expect([ports, spec.defaultPort, spec.designPort]).toEqual([[], '', '']);
        continue;
      }
      expect(ports).toContain(spec.defaultPort);
      expect(ports).toContain(spec.designPort);
      for (const port of Object.values(spec.branches)) expect(ports).toContain(port);
    }
  });

  it('gives abort wording and design only to trigger kinds that abort', () => {
    for (const kind of WORKFLOW_TRIGGER_KINDS) {
      const spec = WORKFLOW_TRIGGER_SPECS[kind];
      expect(spec.abortDesign !== null).toBe(spec.aborts);
      if (!spec.aborts) expect(spec.abortLabel ?? spec.abortHint).toBeUndefined();
    }
    expect(WORKFLOW_TRIGGER_SPECS.event.abortLabel).toBe('When an event happens');
  });

  it('continues a loop after its body at run time, but links a designed step into it', () => {
    expect(WORKFLOW_NODE_SPECS.loop.defaultPort).toBe('done');
    expect(WORKFLOW_NODE_SPECS.loop.designPort).toBe('each');
  });

  it('reads loose JSON with defaults', () => {
    expect(WORKFLOW_NODE_SPECS.loop.read({ maxItems: 900 })).toEqual({
      mode: 'items',
      items: '',
      count: '',
      until: { match: 'all', rules: [] },
      maxItems: 500,
    });
    expect(WORKFLOW_NODE_SPECS.loop.read({ mode: 'count', count: 3 })).toMatchObject({
      mode: 'count',
      count: '3',
    });
    // Missing, clashing and reserved case ids become the next free `case_<n>`.
    expect(
      WORKFLOW_NODE_SPECS.switch
        .read({
          field: ' content.title ',
          cases: [
            { id: 'case_2' },
            { value: 1 },
            { id: 'case_2' },
            { id: 'default', operator: 'nope' },
          ],
        })
        .cases.map((entry) => [entry.id, entry.operator, entry.value]),
    ).toEqual([
      ['case_2', 'equals', ''],
      ['case_1', 'equals', '1'],
      ['case_3', 'equals', ''],
      ['case_4', 'equals', ''],
    ]);
    expect(WORKFLOW_NODE_SPECS.stop.read({ outcome: 'nope', message: ' x ' })).toEqual({
      outcome: 'succeeded',
      message: 'x',
    });
    expect(WORKFLOW_NODE_SPECS.call.read({ input: { text: 3 } })).toEqual({
      workflowId: null,
      input: [{ name: 'text', value: '3' }],
      wait: true,
    });
  });

  it('snaps a read node onto the canvas grid', () => {
    const base = {
      id: 'n1',
      key: 'wait',
      name: '',
      enabled: true,
      continueOnError: false,
      join: 'any' as const,
      ui: { x: 260, y: -7 },
    };
    const node = readWorkflowNode('delay', base, { minutes: 5 });
    expect(node.ui).toEqual({ x: 256, y: 0 });
    expect(Object.is(node.ui.y, -0)).toBe(false);
    expect(base.ui).toEqual({ x: 260, y: -7 });
    expect(snapWorkflowPosition({ x: Number.NaN, y: 1000 })).toEqual({ x: 0, y: 1008 });
    expect(snapWorkflowPosition({ x: Number.POSITIVE_INFINITY, y: 8 })).toEqual({ x: 0, y: 16 });
  });

  it("labels an action node by its action's label, else by its type", () => {
    const node = { kind: 'action', action: 'http' } as WorkflowNode;
    expect(workflowNodeLabel(node, { label: 'Call an API' })).toBe('Call an API');
    expect(workflowNodeLabel(node)).toBe('http');
    expect(workflowNodeLabel({ kind: 'delay' } as WorkflowNode)).toBe('Wait');
  });
});
