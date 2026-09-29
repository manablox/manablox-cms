import type { GraphNode } from '@vue-flow/core';

/** Drag alignment: snaps a node's edges and middle to other nodes' and draws the guide. */

export interface Guide {
  axis: 'x' | 'y';
  /** Where the line sits, in flow coordinates. */
  at: number;
  /** Where the line runs, spanning only the aligned nodes. */
  from: number;
  to: number;
}

export interface Alignment {
  /** The nudge onto the guides. */
  dx: number;
  dy: number;
  guides: Guide[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (node: GraphNode): Box => ({
  x: node.position.x,
  y: node.position.y,
  width: node.dimensions?.width || 288,
  height: node.dimensions?.height || 120,
});

/** A box's two edges and middle on one axis. */
const edgesX = (box: Box) => [box.x, box.x + box.width / 2, box.x + box.width];
const edgesY = (box: Box) => [box.y, box.y + box.height / 2, box.y + box.height];

/** The best alignment for `dragged` among `others`, if any. `threshold` is in flow units. */
export function alignmentFor(
  dragged: GraphNode,
  others: GraphNode[],
  threshold: number,
): Alignment {
  const box = boxOf(dragged);
  const mine = { x: edgesX(box), y: edgesY(box) };

  let best: { x: { delta: number; at: number } | null; y: { delta: number; at: number } | null } = {
    x: null,
    y: null,
  };
  const partners: Record<'x' | 'y', Box[]> = { x: [], y: [] };

  for (const other of others) {
    if (other.id === dragged.id) continue;
    const theirs = boxOf(other);
    for (const axis of ['x', 'y'] as const) {
      const ours = mine[axis];
      const lines = axis === 'x' ? edgesX(theirs) : edgesY(theirs);
      for (const [index, line] of lines.entries()) {
        const delta = line - (ours[index] as number);
        if (Math.abs(delta) > threshold) continue;
        const current = best[axis];
        if (!current || Math.abs(delta) < Math.abs(current.delta)) {
          best = { ...best, [axis]: { delta, at: line } };
          partners[axis] = [theirs];
        } else if (Math.abs(delta - current.delta) < 0.5) {
          // The guide spans every node on the line.
          partners[axis].push(theirs);
        }
      }
    }
  }

  const dx = best.x?.delta ?? 0;
  const dy = best.y?.delta ?? 0;
  const moved: Box = { ...box, x: box.x + dx, y: box.y + dy };
  const guides: Guide[] = [];

  if (best.x) {
    const boxes = [moved, ...partners.x];
    guides.push({
      axis: 'x',
      at: best.x.at,
      from: Math.min(...boxes.map((entry) => entry.y)) - 24,
      to: Math.max(...boxes.map((entry) => entry.y + entry.height)) + 24,
    });
  }
  if (best.y) {
    const boxes = [moved, ...partners.y];
    guides.push({
      axis: 'y',
      at: best.y.at,
      from: Math.min(...boxes.map((entry) => entry.x)) - 24,
      to: Math.max(...boxes.map((entry) => entry.x + entry.width)) + 24,
    });
  }

  return { dx, dy, guides };
}
