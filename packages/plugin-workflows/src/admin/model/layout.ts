import {
  snapWorkflowPosition,
  WORKFLOW_GRID,
  WORKFLOW_LAYOUT,
  WORKFLOW_TRIGGER_ID,
  type WorkflowEdge,
  type WorkflowNode,
  workflowNodePorts,
} from '../../sdk';

/** How tightly `autoLayout` packs: relaxed gives every branch its own band, compact lets them interlock. */
export type LayoutDensity = 'compact' | 'relaxed';

/** A card's height when it has not been measured; a relaxed row is this plus its gap. */
export const LAYOUT_CARD_HEIGHT = WORKFLOW_LAYOUT.y - 64;

/**
 * Column step and the least space between a row's tallest card and the next row, in px.
 * A line leaves its socket and enters its node 20px straight, so a gap under 40px would
 * make it turn back up.
 */
export const LAYOUT_SPACING: Record<LayoutDensity, { x: number; gap: number }> = {
  compact: { x: 320, gap: 48 },
  relaxed: { x: WORKFLOW_LAYOUT.laneX, gap: 64 },
};

/**
 * Which side a branch leaves by (-1, 0, 1). Conditions always fork; actions go straight and
 * only `error` steps aside; a switch fans its ports out left to right.
 */
function portSide(node: WorkflowNode | undefined, port: string): number {
  if (node?.kind === 'condition') return port === 'false' ? 1 : -1;
  // What runs per item hangs beside the loop; what follows the last item carries on down.
  if (node?.kind === 'loop') return port === 'each' ? 1 : 0;
  if (node?.kind === 'switch') {
    const ports = workflowNodePorts(node);
    const index = ports.findIndex((entry) => entry.name === port);
    return index < 0 ? 1 : Math.sign(index - (ports.length - 1) / 2);
  }
  return port === 'error' || port === 'false' ? 1 : 0;
}

/** A port's place among its node's, so siblings keep the order of their sockets. */
function portOrder(node: WorkflowNode | undefined, port: string): number {
  return node?.kind === 'switch'
    ? workflowNodePorts(node).findIndex((entry) => entry.name === port)
    : 0;
}

/** Per row, the columns a block's cards reach, half a column past the outermost. */
type Contour = Map<number, { min: number; max: number }>;

/** A laid-out subtree in columns relative to its root. Edges sit half a column past the outermost cards. */
interface Block {
  at: Map<string, number>;
  min: number;
  max: number;
}

/**
 * Positions for an unlaid or tidied graph. Rows are distance from the trigger; each node's
 * branches get room of their own on their socket's side, so no branch overlaps another.
 */
export function autoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  density: LayoutDensity = 'relaxed',
  /** Rendered card heights by node id, the trigger's included; unmeasured cards count as `LAYOUT_CARD_HEIGHT`. */
  heights?: ReadonlyMap<string, number>,
): WorkflowNode[] {
  const compact = density === 'compact';
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const known = new Set<string>([WORKFLOW_TRIGGER_ID, ...byId.keys()]);
  const live = edges.filter((edge) => known.has(edge.from) && known.has(edge.to));
  const depth = new Map<string, number>([[WORKFLOW_TRIGGER_ID, 0]]);

  // Longest path from the trigger, so a node always sits below everything feeding it.
  const deepen = () => {
    for (let pass = 0; pass < nodes.length + 1; pass++) {
      let changed = false;
      for (const edge of live) {
        const from = depth.get(edge.from);
        if (from === undefined) continue;
        const next = from + 1;
        if ((depth.get(edge.to) ?? -1) < next) {
          depth.set(edge.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
  };
  deepen();
  // What the trigger cannot reach starts a row below it, and its chains go down from there.
  for (const node of nodes) {
    if (depth.has(node.id)) continue;
    depth.set(node.id, 1);
    deepen();
  }

  /** The parent a node hangs from: the deepest one. Other incoming edges are drawn as joins. */
  const parents = new Map<string, string[]>();
  const hanger = new Map<string, { from: string; port: string; at: number }>();
  live.forEach((edge, at) => {
    parents.set(edge.to, [...(parents.get(edge.to) ?? []), edge.from]);
    const held = hanger.get(edge.to);
    if (!held || (depth.get(edge.from) ?? -1) > (depth.get(held.from) ?? -1)) {
      hanger.set(edge.to, { from: edge.from, port: edge.fromPort, at });
    }
  });

  const children = new Map<
    string,
    Array<{ id: string; side: number; order: number; at: number }>
  >();
  for (const [id, edge] of hanger) {
    const from = byId.get(edge.from);
    const kid = {
      id,
      side: portSide(from, edge.port),
      order: portOrder(from, edge.port),
      at: edge.at,
    };
    children.set(edge.from, [...(children.get(edge.from) ?? []), kid]);
  }
  for (const [, kids] of children) {
    kids.sort((a, b) => a.side - b.side || a.order - b.order || a.at - b.at);
  }

  const rowOf = (id: string) => depth.get(id) ?? 1;

  /** The contour of cards at `at`, moved by `shift` columns. */
  const contourOf = (at: Map<string, number>, shift = 0): Contour => {
    const rows: Contour = new Map();
    for (const [id, offset] of at) {
      const row = rowOf(id);
      const column = offset + shift;
      const seen = rows.get(row);
      rows.set(row, {
        min: Math.min(seen?.min ?? Number.POSITIVE_INFINITY, column - 0.5),
        max: Math.max(seen?.max ?? Number.NEGATIVE_INFINITY, column + 0.5),
      });
    }
    return rows;
  };
  const merge = (into: Contour, rows: Contour) => {
    for (const [row, span] of rows) {
      const seen = into.get(row);
      into.set(row, {
        min: Math.min(seen?.min ?? span.min, span.min),
        max: Math.max(seen?.max ?? span.max, span.max),
      });
    }
  };
  /** The least shift that puts `rows` right of `wall` on every row they share; -Infinity when none. */
  const clearRight = (wall: Contour, rows: Contour) => {
    let shift = Number.NEGATIVE_INFINITY;
    for (const [row, span] of rows) {
      const blocked = wall.get(row);
      if (blocked) shift = Math.max(shift, blocked.max - span.min);
    }
    return shift;
  };
  /** The greatest shift that puts `rows` left of `wall` on every row they share; Infinity when none. */
  const clearLeft = (wall: Contour, rows: Contour) => {
    let shift = Number.POSITIVE_INFINITY;
    for (const [row, span] of rows) {
      const blocked = wall.get(row);
      if (blocked) shift = Math.min(shift, blocked.min - span.max);
    }
    return shift;
  };

  const done = new Set<string>();

  /** Blocks side by side from `edge` rightwards; the roots land where their blocks do. */
  const pack = (blocks: Block[], edge: number) => {
    let cursor = edge;
    const shifts = blocks.map((block) => {
      const shift = cursor - block.min;
      cursor = shift + block.max;
      return shift;
    });
    return { shifts, min: edge, max: cursor };
  };

  /** As `pack`, but each block only clears the cards on the rows it shares with those before it. */
  const interlock = (blocks: Block[], edge: number) => {
    const wall: Contour = new Map();
    let reach = edge;
    const shifts = blocks.map((block) => {
      const rows = contourOf(block.at);
      const needed = clearRight(wall, rows);
      const shift = needed === Number.NEGATIVE_INFINITY ? reach - block.min : needed;
      merge(wall, contourOf(block.at, shift));
      reach = Math.max(reach, shift + block.max);
      return shift;
    });
    return { shifts, min: edge, max: reach };
  };

  const build = (id: string): Block => {
    done.add(id);
    const kids = (children.get(id) ?? []).filter((kid) => !done.has(kid.id));
    const blocks = new Map(kids.map((kid) => [kid.id, build(kid.id)]));
    const of = (side: number) => kids.filter((kid) => kid.side === side);
    const at = new Map<string, number>([[id, 0]]);
    let min = -0.5;
    let max = 0.5;

    const add = (group: Array<{ id: string }>, shifts: number[]) => {
      group.forEach((kid, index) => {
        const shift = shifts[index] as number;
        for (const [inner, offset] of (blocks.get(kid.id) as Block).at) {
          at.set(inner, offset + shift);
        }
      });
    };

    // Straight on first, centred under this node.
    const straight = of(0);
    let ahead: { min: number; max: number } | null = null;
    if (straight.length) {
      const packed = (compact ? interlock : pack)(
        straight.map((kid) => blocks.get(kid.id) as Block),
        0,
      );
      const roots = packed.shifts;
      const centre = ((roots[0] as number) + (roots[roots.length - 1] as number)) / 2;
      add(
        straight,
        packed.shifts.map((shift) => shift - centre),
      );
      ahead = { min: packed.min - centre, max: packed.max - centre };
      min = Math.min(min, ahead.min);
      max = Math.max(max, ahead.max);
    }

    // Then the sides. A side branch clears the straight-on run but may sit half under
    // this node's card, a row above, which puts it under its socket.
    if (compact) {
      // Each side branch only clears the cards on the rows it shares, root beside this node.
      const wall = contourOf(at);
      for (const kid of of(1)) {
        const block = blocks.get(kid.id) as Block;
        const rows = contourOf(block.at);
        const shift = Math.max(clearRight(wall, rows), 0.5 - (block.at.get(kid.id) ?? 0));
        add([kid], [shift]);
        merge(wall, contourOf(block.at, shift));
      }
      for (const kid of of(-1).reverse()) {
        const block = blocks.get(kid.id) as Block;
        const rows = contourOf(block.at);
        const shift = Math.min(clearLeft(wall, rows), -0.5 - (block.at.get(kid.id) ?? 0));
        add([kid], [shift]);
        merge(wall, contourOf(block.at, shift));
      }
      const columns = [...at.values()];
      return { at, min: Math.min(...columns) - 0.5, max: Math.max(...columns) + 0.5 };
    }

    const right = of(1);
    if (right.length) {
      const packed = pack(
        right.map((kid) => blocks.get(kid.id) as Block),
        Math.max(0, ahead?.max ?? 0),
      );
      add(right, packed.shifts);
      max = Math.max(max, packed.max);
    }
    const left = of(-1);
    if (left.length) {
      const packed = pack(
        left.map((kid) => blocks.get(kid.id) as Block),
        0,
      );
      const target = Math.min(0, ahead?.min ?? 0) - packed.max;
      add(
        left,
        packed.shifts.map((shift) => shift + target),
      );
      min = Math.min(min, packed.min + target);
    }

    return { at, min, max };
  };

  // The trigger's own tree first, then anything it cannot reach, laid out beside it.
  const column = new Map<string, number>();
  let edge = Number.NEGATIVE_INFINITY;
  const root = (id: string) => {
    const block = build(id);
    const shift = edge === Number.NEGATIVE_INFINITY ? 0 : edge - block.min;
    for (const [inner, offset] of block.at) column.set(inner, offset + shift);
    edge = block.max + shift;
  };

  root(WORKFLOW_TRIGGER_ID);
  for (const node of nodes) {
    if (!done.has(node.id)) root(node.id);
  }

  /** A node fed by several branches centres under them when there is room. */
  for (const node of nodes) {
    const above = parents.get(node.id) ?? [];
    if (above.length < 2) continue;
    const middle = above.reduce((sum, id) => sum + (column.get(id) ?? 0), 0) / above.length;
    const clash = [...column].some(
      ([id, at]) => id !== node.id && rowOf(id) === rowOf(node.id) && Math.abs(at - middle) < 1,
    );
    if (!clash) column.set(node.id, middle);
  }

  // Each row starts below the tallest card of the row above, rounded up to the grid.
  const spacing = LAYOUT_SPACING[density];
  const tallest = new Map<number, number>();
  for (const id of [WORKFLOW_TRIGGER_ID, ...nodes.map((node) => node.id)]) {
    const height = heights?.get(id) || LAYOUT_CARD_HEIGHT;
    tallest.set(rowOf(id), Math.max(tallest.get(rowOf(id)) ?? 0, height));
  }
  const rowTop = [0];
  const lastRow = Math.max(...tallest.keys());
  for (let row = 1; row <= lastRow; row++) {
    const above = (rowTop[row - 1] as number) + (tallest.get(row - 1) ?? 0) + spacing.gap;
    rowTop.push(Math.ceil(above / WORKFLOW_GRID) * WORKFLOW_GRID);
  }

  const origin = column.get(WORKFLOW_TRIGGER_ID) ?? 0;
  return nodes.map((node) => ({
    ...node,
    ui: snapWorkflowPosition({
      x: ((column.get(node.id) ?? 0) - origin) * spacing.x,
      y: rowTop[rowOf(node.id)] ?? 0,
    }),
  }));
}

/** Where a palette drop lands: under its socket a row below its parent, as `autoLayout` would, moved along until clear. */
export function spotUnder(
  nodes: WorkflowNode[],
  parent: WorkflowNode | null,
  port: string,
): { x: number; y: number } {
  const y = (parent ? parent.ui.y : 0) + WORKFLOW_LAYOUT.y;
  const side = parent ? portSide(parent, port) : 0;
  const step = (side || 1) * WORKFLOW_LAYOUT.laneX;
  let x = (parent ? parent.ui.x : 0) + (side * WORKFLOW_LAYOUT.laneX) / 2;
  while (nodes.some((node) => node.ui.y === y && Math.abs(node.ui.x - x) < WORKFLOW_LAYOUT.laneX)) {
    x += step;
  }
  return { x, y };
}
