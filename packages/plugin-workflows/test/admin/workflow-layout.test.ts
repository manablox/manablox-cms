import { describe, expect, it } from 'vitest';
import {
  autoLayout,
  freePort,
  hintsFor,
  LAYOUT_CARD_HEIGHT,
  LAYOUT_SPACING,
  newEventTrigger,
  spotUnder,
  untilHintsFor,
} from '../../src/admin/model';
import type { WorkflowEdge, WorkflowNode } from '../../src/sdk';
import { WORKFLOW_LAYOUT, WORKFLOW_TRIGGER_ID } from '../../src/sdk';

const node = (id: string): WorkflowNode => ({
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
  ui: { x: 0, y: 0 },
});

const fork = (id: string): WorkflowNode => ({
  ...(node(id) as WorkflowNode),
  kind: 'condition',
  match: 'all',
  rules: [],
});

const edge = (from: string, fromPort: string, to: string): WorkflowEdge => ({
  id: `${from}-${fromPort}-${to}`,
  from,
  fromPort,
  to,
  guard: null,
});

const at = (laid: WorkflowNode[], id: string) => laid.find((one) => one.id === id)?.ui;

describe('autoLayout', () => {
  it('hangs a straight run in one column under the trigger', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'a'),
      edge('a', 'ok', 'b'),
      edge('b', 'ok', 'c'),
    ];
    const laid = autoLayout(nodes, edges);
    expect(laid.map((one) => one.ui)).toEqual([
      { x: 0, y: WORKFLOW_LAYOUT.y },
      { x: 0, y: WORKFLOW_LAYOUT.y * 2 },
      { x: 0, y: WORKFLOW_LAYOUT.y * 3 },
    ]);
  });

  it('puts a fork left and right below the node it leaves, in socket order', () => {
    const nodes = [fork('fork'), node('yes'), node('no')];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'fork'),
      // Drawn false-first: sockets decide, not drawing order.
      edge('fork', 'false', 'no'),
      edge('fork', 'true', 'yes'),
    ];
    const laid = autoLayout(nodes, edges);
    const yes = at(laid, 'yes');
    const no = at(laid, 'no');
    expect(at(laid, 'fork')?.x).toBe(0);
    expect(yes?.x).toBe(-WORKFLOW_LAYOUT.laneX / 2);
    expect(no?.x).toBe(WORKFLOW_LAYOUT.laneX / 2);
    expect(yes?.y).toBe(WORKFLOW_LAYOUT.y * 2);
    expect(no?.y).toBe(WORKFLOW_LAYOUT.y * 2);
  });

  it('steps a fork aside even when only one side is wired up', () => {
    const nodes = [fork('fork'), node('yes')];
    const laid = autoLayout(nodes, [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'fork'),
      edge('fork', 'true', 'yes'),
    ]);
    expect(at(laid, 'yes')?.x).toBe((at(laid, 'fork')?.x as number) - WORKFLOW_LAYOUT.laneX / 2);
  });

  it("keeps an action's run straight and steps only its failure aside", () => {
    const nodes = ['call', 'then', 'rescue'].map(node);
    const laid = autoLayout(nodes, [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'call'),
      edge('call', 'ok', 'then'),
      edge('call', 'error', 'rescue'),
    ]);
    expect(at(laid, 'then')?.x).toBe(at(laid, 'call')?.x);
    expect(at(laid, 'rescue')?.x).toBeGreaterThanOrEqual(
      (at(laid, 'then')?.x as number) + WORKFLOW_LAYOUT.laneX,
    );
  });

  it('keeps two branches from landing on each other', () => {
    const nodes = [fork('fork'), node('yes'), node('yes2'), node('no')];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'fork'),
      edge('fork', 'true', 'yes'),
      edge('yes', 'ok', 'yes2'),
      edge('fork', 'false', 'no'),
    ];
    const laid = autoLayout(nodes, edges);
    const rows = new Map<number, number[]>();
    for (const one of laid) rows.set(one.ui.y, [...(rows.get(one.ui.y) ?? []), one.ui.x]);
    for (const [, xs] of rows) {
      const sorted = [...xs].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeGreaterThanOrEqual(
          WORKFLOW_LAYOUT.laneX,
        );
      }
    }
    // A single child stays directly under its parent.
    expect(at(laid, 'yes2')?.x).toBe(at(laid, 'yes')?.x);
  });

  it('centres a join under the branches that feed it', () => {
    const nodes = [fork('fork'), node('yes'), node('no'), node('join')];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'fork'),
      edge('fork', 'true', 'yes'),
      edge('fork', 'false', 'no'),
      edge('yes', 'ok', 'join'),
      edge('no', 'ok', 'join'),
    ];
    const laid = autoLayout(nodes, edges);
    expect(at(laid, 'join')?.x).toBe(at(laid, 'fork')?.x);
    expect(at(laid, 'join')?.y).toBe(WORKFLOW_LAYOUT.y * 3);
  });

  it('lays a graph the trigger cannot reach out beside it', () => {
    const nodes = [node('a'), node('loose')];
    const laid = autoLayout(nodes, [edge(WORKFLOW_TRIGGER_ID, 'out', 'a')]);
    expect(at(laid, 'a')?.x).not.toBe(at(laid, 'loose')?.x);
  });

  it('survives a cycle', () => {
    const nodes = [node('a'), node('b')];
    const edges = [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'a'),
      edge('a', 'ok', 'b'),
      edge('b', 'ok', 'a'),
    ];
    expect(() => autoLayout(nodes, edges)).not.toThrow();
  });
});

describe('spotUnder', () => {
  it('drops a new node under the socket it is joined to', () => {
    const parent = { ...fork('check'), ui: { x: 0, y: WORKFLOW_LAYOUT.y } };
    expect(spotUnder([parent], parent, 'true')).toEqual({
      x: -WORKFLOW_LAYOUT.laneX / 2,
      y: WORKFLOW_LAYOUT.y * 2,
    });
    expect(spotUnder([parent], parent, 'false')).toEqual({
      x: WORKFLOW_LAYOUT.laneX / 2,
      y: WORKFLOW_LAYOUT.y * 2,
    });
  });

  it('carries an action straight on', () => {
    const parent = { ...node('call'), ui: { x: WORKFLOW_LAYOUT.laneX, y: WORKFLOW_LAYOUT.y } };
    expect(spotUnder([parent], parent, 'ok')).toEqual({
      x: WORKFLOW_LAYOUT.laneX,
      y: WORKFLOW_LAYOUT.y * 2,
    });
  });

  it('moves along when the spot is taken', () => {
    const parent = { ...node('call'), ui: { x: 0, y: 0 } };
    const taken = { ...node('there'), ui: { x: 0, y: WORKFLOW_LAYOUT.y } };
    expect(spotUnder([parent, taken], parent, 'ok')).toEqual({
      x: WORKFLOW_LAYOUT.laneX,
      y: WORKFLOW_LAYOUT.y,
    });
  });

  it('starts under the trigger when there is nothing to hang from', () => {
    expect(spotUnder([], null, 'out')).toEqual({ x: 0, y: WORKFLOW_LAYOUT.y });
  });
});

describe('freePort', () => {
  const call = node('call');

  it('takes the first socket with nothing on it', () => {
    expect(freePort(call, [], [])).toBe('ok');
    expect(freePort(call, [], [edge('call', 'ok', 'next')])).toBe('error');
  });

  it("takes a fork's other side once one is used", () => {
    const check = fork('check');
    expect(freePort(check, [], [edge('check', 'true', 'yes')])).toBe('false');
  });

  it('goes back to the first when every socket is in use, since one carries many lines', () => {
    const used = [edge('call', 'ok', 'a'), edge('call', 'error', 'b')];
    expect(freePort(call, [], used)).toBe('ok');
  });

  it('offers the trigger its own socket', () => {
    expect(freePort(null, [], [])).toBe('out');
  });
});

describe('a loop in the editor', () => {
  const loop = (id: string): WorkflowNode => ({
    ...(node(id) as WorkflowNode),
    kind: 'loop',
    mode: 'items',
    items: '',
    count: '',
    until: { match: 'all', rules: [] },
    maxItems: 50,
  });
  const nodes = [node('fetch'), loop('each'), node('per_item'), node('after')];
  const edges = [
    edge(WORKFLOW_TRIGGER_ID, 'out', 'fetch'),
    edge('fetch', 'ok', 'each'),
    edge('each', 'each', 'per_item'),
    edge('each', 'done', 'after'),
  ];

  it('hangs the branch beside the loop and carries on under it', () => {
    const laid = autoLayout(nodes, edges);
    expect(at(laid, 'after')?.x).toBe(at(laid, 'each')?.x);
    expect(at(laid, 'per_item')?.x).toBeGreaterThan(at(laid, 'each')?.x ?? 0);
  });

  it('offers the item inside the branch, and the passes after it', () => {
    const inside = hintsFor({ trigger: newEventTrigger(), nodes, edges }, 'per_item', []);
    const after = hintsFor({ trigger: newEventTrigger(), nodes, edges }, 'after', []);
    expect(inside.map((hint) => hint.path)).toContain('item');
    expect(inside.map((hint) => hint.path)).not.toContain('nodes.each.results');
    expect(after.map((hint) => hint.path)).toContain('nodes.each.results');
    expect(after.map((hint) => hint.path)).not.toContain('item');
  });

  it('offers a new node after a loop the side nothing hangs from yet', () => {
    expect(freePort(loop('each'), [], [edge('each', 'each', 'x')])).toBe('done');
  });
});

describe('a switch in the editor', () => {
  const route = (id: string, cases: number): WorkflowNode => ({
    ...(node(id) as WorkflowNode),
    kind: 'switch',
    field: 'content.typeId',
    cases: Array.from({ length: cases }, (_, i) => ({
      id: `case_${i + 1}`,
      label: '',
      operator: 'equals' as const,
      value: String(i),
    })),
  });

  it('fans its cases out left to right in socket order, otherwise on the right', () => {
    const nodes = [route('pick', 2), node('a'), node('b'), node('other')];
    const laid = autoLayout(nodes, [
      edge(WORKFLOW_TRIGGER_ID, 'out', 'pick'),
      edge('pick', 'default', 'other'),
      edge('pick', 'case_2', 'b'),
      edge('pick', 'case_1', 'a'),
    ]);
    const x = (id: string) => at(laid, id)?.x as number;
    expect(x('a')).toBeLessThan(x('pick'));
    expect(x('b')).toBe(x('pick'));
    expect(x('other')).toBeGreaterThan(x('pick'));
  });

  it('offers what it chose to the nodes after it', () => {
    const nodes = [route('pick', 1), node('after')];
    const edges = [edge(WORKFLOW_TRIGGER_ID, 'out', 'pick'), edge('pick', 'case_1', 'after')];
    const paths = hintsFor({ trigger: newEventTrigger(), nodes, edges }, 'after', []).map(
      (hint) => hint.path,
    );
    expect(paths).toEqual(expect.arrayContaining(['nodes.pick.label', 'nodes.pick.case']));
  });
});

describe('arranging compact or relaxed', () => {
  /** A fork whose yes side runs deep and whose no side is one node. */
  const nodes = [fork('check'), node('y1'), node('y2'), node('y3'), node('n1'), node('next')];
  const edges = [
    edge(WORKFLOW_TRIGGER_ID, 'out', 'check'),
    edge('check', 'true', 'y1'),
    edge('y1', 'ok', 'y2'),
    edge('y2', 'ok', 'y3'),
    edge('y2', 'error', 'next'),
    edge('check', 'false', 'n1'),
  ];

  it('spaces rows and columns by the density', () => {
    const relaxed = autoLayout(nodes, edges, 'relaxed');
    const compact = autoLayout(nodes, edges, 'compact');
    const row = (density: 'compact' | 'relaxed') =>
      LAYOUT_CARD_HEIGHT + LAYOUT_SPACING[density].gap;
    expect(at(relaxed, 'y1')?.y).toBe(WORKFLOW_LAYOUT.y * 2);
    expect(at(relaxed, 'y1')?.y).toBe(row('relaxed') * 2);
    expect(at(compact, 'y1')?.y).toBe(row('compact') * 2);
    expect(LAYOUT_SPACING.compact.x).toBeLessThan(LAYOUT_SPACING.relaxed.x);
    expect(autoLayout(nodes, edges)).toEqual(relaxed);
  });

  it('starts each row below the tallest card above it, so no line turns back up', () => {
    const heights = new Map([
      [WORKFLOW_TRIGGER_ID, 64],
      ['check', 180],
      ['y1', 90],
      ['n1', 150],
    ]);
    for (const density of ['compact', 'relaxed'] as const) {
      const laid = autoLayout(nodes, edges, density, heights);
      const gap = LAYOUT_SPACING[density].gap;
      const y = (id: string) => at(laid, id)?.y as number;
      expect(y('check')).toBeGreaterThanOrEqual(64 + gap);
      expect(y('y1') - y('check')).toBeGreaterThanOrEqual(180 + gap);
      // `n1` shares the row with `y1`: the row below clears the taller of the two.
      expect(y('y2') - y('y1')).toBeGreaterThanOrEqual(150 + gap);
      expect(gap).toBeGreaterThanOrEqual(40);
      for (const one of laid) expect(one.ui.y % 16).toBe(0);
    }
  });

  it('lets a branch tuck under its neighbour in compact, never onto another card', () => {
    const width = (laid: WorkflowNode[], step: number) => {
      const columns = laid.map((one) => one.ui.x / step);
      return Math.max(...columns) - Math.min(...columns);
    };
    const relaxed = autoLayout(nodes, edges, 'relaxed');
    const compact = autoLayout(nodes, edges, 'compact');
    expect(width(compact, LAYOUT_SPACING.compact.x)).toBeLessThan(
      width(relaxed, LAYOUT_SPACING.relaxed.x),
    );
    for (const laid of [relaxed, compact]) {
      const spots = laid.map((one) => `${one.ui.x}:${one.ui.y}`);
      expect(new Set(spots).size).toBe(spots.length);
    }
    for (const [a, b] of compact.flatMap((one, i) =>
      compact.slice(i + 1).map((two) => [one, two]),
    )) {
      if (a?.ui.y !== b?.ui.y) continue;
      expect(Math.abs((a?.ui.x ?? 0) - (b?.ui.x ?? 0))).toBeGreaterThanOrEqual(
        LAYOUT_SPACING.compact.x,
      );
    }
  });

  it('gives a chain the trigger cannot reach rows of its own', () => {
    const laid = autoLayout([node('a'), node('b')], [edge('a', 'ok', 'b')], 'compact');
    expect(at(laid, 'b')?.y).toBeGreaterThan(at(laid, 'a')?.y as number);
  });
});

describe('repeat rules', () => {
  it('may read what the loop branch produced, and the pass', () => {
    const loop = {
      ...(node('again') as WorkflowNode),
      kind: 'loop',
      mode: 'until',
      items: '',
      count: '',
      until: { match: 'all', rules: [] },
      maxItems: 5,
    } as WorkflowNode & { kind: 'loop' };
    const nodes = [loop, node('fetch')];
    const edges = [edge(WORKFLOW_TRIGGER_ID, 'out', 'again'), edge('again', 'each', 'fetch')];
    const paths = untilHintsFor({ trigger: newEventTrigger(), nodes, edges }, loop, []).map(
      (hint) => hint.path,
    );
    expect(paths).toEqual(expect.arrayContaining(['nodes.fetch', 'loop.index']));
    expect(paths).not.toContain('loop.count');
  });
});
