import { describe, expect, it } from 'vitest';
import {
  CYCLE,
  fadeAt,
  LINKS,
  NODES,
  PACKET_FADE,
  PACKET_RADIUS,
  PHASE,
  type Point,
  pointAtDistance,
  polyline,
  sceneBlocks,
  sceneLinks,
  sceneViewBox,
  TAIL,
  TAIL_LEAD,
  TRAIL_FADE,
  tailSpan,
  travelEase,
} from '~/components/auth-scene';

/* The packet's scale keyframes from `mb-flow-packet-body`; the conflict scan needs its real footprint. */
const PACKET_SCALE: [number, number][] = [
  [0, 0.01],
  [0.18, 1],
  [0.85, 1],
  [1, 0.01],
];

/** Below this a thing is fading in or out and not tracked by the eye. */
const VISIBLE = 0.5;

type Conflict = { at: number; tail: number; packet: number };

/** Steps through the cycle and reports every visible tail point inside another link's packet halo. */
function conflicts(phase: number[], steps = 360, samples = 40): Conflict[] {
  const links = sceneLinks(phase);
  const found: Conflict[] = [];
  for (let s = 0; s < steps; s++) {
    const at = s / steps;
    const packets = links.map((link) => {
      const t = (at + link.offset) % 1;
      return {
        t,
        visible: fadeAt(PACKET_FADE, t) >= VISIBLE,
        radius: PACKET_RADIUS * fadeAt(PACKET_SCALE, t),
        centre: pointAtDistance(link.points, travelEase(t) * link.length),
      };
    });
    for (let i = 0; i < links.length; i++) {
      const link = links[i] as (typeof links)[number];
      const t = (packets[i] as { t: number }).t;
      if (fadeAt(TRAIL_FADE, t) < VISIBLE) continue;
      // The lit run ends a lead behind the packet and reaches its own span back.
      const head = travelEase(t) * link.length - TAIL_LEAD;
      const span = tailSpan(link.length);
      for (let k = 0; k <= samples; k++) {
        const along = head - (span * k) / samples;
        if (along < 0 || along > link.length) continue;
        const lit = pointAtDistance(link.points, along);
        for (let j = 0; j < links.length; j++) {
          const other = packets[j] as { visible: boolean; radius: number; centre: Point };
          if (i === j || !other.visible) continue;
          const gap = Math.hypot(lit[0] - other.centre[0], lit[1] - other.centre[1]);
          if (gap < other.radius) found.push({ at, tail: i, packet: j });
        }
      }
    }
  }
  return found;
}

describe('the phase order', () => {
  /* Only 24 of the 720 orders are clean; re-run the search when reordering links. */
  it('leaves no tail lying on another link’s packet', () => {
    expect(conflicts(PHASE)).toEqual([]);
  });

  it('is not the order the links are declared in', () => {
    const counted = LINKS.map((_, i) => i);
    expect(PHASE).not.toEqual(counted);
    expect(conflicts(counted).length).toBeGreaterThan(0);
  });

  it('reversing it or pairing the branches also conflicts', () => {
    expect(conflicts([5, 4, 3, 2, 1, 0]).length).toBeGreaterThan(0);
    expect(conflicts([0, 2, 4, 1, 3, 5]).length).toBeGreaterThan(0);
  });

  it('spreads the six runs one sixth of the period apart', () => {
    expect([...PHASE].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const links = sceneLinks();
    expect(links.map((l) => l.delay)).toEqual([
      '0.000s',
      '-2.600s',
      '-0.867s',
      '-4.333s',
      '-3.467s',
      '-1.733s',
    ]);
    expect(CYCLE).toBe(5.2);
  });
});

describe('a tail', () => {
  it('ends behind its packet and never reaches past it', () => {
    for (const link of sceneLinks()) {
      const span = tailSpan(link.length);
      const period = span + link.length;
      for (const [index, band] of link.trail.entries()) {
        const bandSpan = span * (TAIL[index] as { span: number }).span;
        const bandPeriod = bandSpan + link.length;
        // The lit end trails the packet by a lead. Three decimals match the attribute's precision.
        expect(Number(band.from) - bandPeriod).toBeCloseTo(bandSpan + TAIL_LEAD, 3);
        expect(Number(band.to) - bandPeriod).toBeCloseTo(bandSpan + TAIL_LEAD - link.length, 3);
        expect(band.dash).toBe(`${bandSpan.toFixed(3)} ${link.length.toFixed(3)}`);
      }
      // The gap spans the wire, so the pattern cannot wrap twice.
      expect(period).toBeGreaterThan(link.length);
    }
  });

  it('is a quarter of its wire, and capped', () => {
    expect(tailSpan(1)).toBeCloseTo(0.26, 6);
    expect(tailSpan(10)).toBe(0.65);
  });
});

describe('the geometry', () => {
  it('draws one wire per link, from block top to block top', () => {
    const links = sceneLinks();
    expect(links).toHaveLength(LINKS.length);
    for (const [index, link] of links.entries()) {
      const [, to] = LINKS[index] as [number, number];
      const target = NODES[to] as { x: number; y: number; t: number };
      const end = pointAtDistance(link.points, link.length);
      expect(end[0]).toBeCloseTo(link.end[0], 2);
      expect(link.end[1]).toBeCloseTo((target.x + target.y) * 0.5 - target.t, 6);
    }
  });

  it('measures a polyline against the coordinates the browser will parse', () => {
    const { d, length, points } = polyline([0, 0], [1, 2], [2, 0]);
    expect(points).toHaveLength(49);
    expect(d.startsWith('M 0.000,0.000 L ')).toBe(true);
    expect(d.endsWith('L 2.000,0.000')).toBe(true);
    // A straight run is its own length, exactly.
    expect(polyline([0, 0], [1, 0], [2, 0]).length).toBeCloseTo(2, 6);
    expect(length).toBeGreaterThan(2);
  });

  it('gives every block three faces and the scene a box that holds them', () => {
    const blocks = sceneBlocks();
    expect(blocks).toHaveLength(NODES.length);
    for (const block of blocks) {
      for (const face of [block.top, block.left, block.right]) {
        expect(face.split(' ')).toHaveLength(4);
      }
    }
    expect(sceneViewBox()).toBe('-1.67 -2.19 8.60 6.44');
  });
});

describe('the envelopes', () => {
  it('hold the packet out of sight until it is clear of the block it left', () => {
    expect(fadeAt(PACKET_FADE, 0)).toBe(0);
    expect(fadeAt(PACKET_FADE, 0.08)).toBeCloseTo(0.16, 6);
    expect(fadeAt(PACKET_FADE, 0.5)).toBe(1);
    expect(fadeAt(PACKET_FADE, 1)).toBe(0);
  });

  it('take the wake out before the packet it belongs to', () => {
    expect(fadeAt(TRAIL_FADE, 0.88)).toBeCloseTo(0, 6);
    expect(fadeAt(PACKET_FADE, 0.88)).toBeGreaterThan(0);
  });

  it('read the travel easing as the stylesheet states it', () => {
    expect(travelEase(0)).toBeCloseTo(0, 6);
    expect(travelEase(0.5)).toBeCloseTo(0.5, 6);
    expect(travelEase(1)).toBeCloseTo(1, 6);
    // Slow at the ends, quick through the middle.
    expect(travelEase(0.25)).toBeLessThan(0.25);
    expect(travelEase(0.75)).toBeGreaterThan(0.75);
  });
});
