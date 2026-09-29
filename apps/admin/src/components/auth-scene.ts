/** Geometry for `AuthScene.vue`, kept here so `test/auth-scene.test.ts` can check it. */

/** Isometric projection. Y grows downward; `z` lifts a point up the screen. */
const COS30 = 0.866;

function iso(x: number, y: number, z = 0): Point {
  return [(x - y) * COS30, (x + y) * 0.5 - z];
}

export type Point = [number, number];

export type SceneNode = { x: number; y: number; s: number; t: number };

/** Grid position, half-width and thickness. */
export const NODES: SceneNode[] = [
  { x: 0, y: 0, s: 0.62, t: 0.42 },
  { x: 2.1, y: -1.15, s: 0.5, t: 0.32 },
  { x: 2.1, y: 1.15, s: 0.5, t: 0.32 },
  { x: 4.2, y: -2.3, s: 0.4, t: 0.24 },
  { x: 4.2, y: 0, s: 0.4, t: 0.24 },
  { x: 4.2, y: 2.3, s: 0.4, t: 0.24 },
];

/** Which block feeds which. */
export const LINKS: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 3],
  [1, 4],
  [2, 4],
  [2, 5],
];

/**
 * Which sixth of the period each link starts on. The only permutation where no tail passes
 * in front of another link's packet; the test pins this.
 */
export const PHASE: number[] = [0, 3, 1, 5, 4, 2];

/** One traverse in seconds; every animation shares it. Must match the stylesheet. */
export const CYCLE = 5.2;

function point([x, y]: Point): string {
  return `${x.toFixed(3)},${y.toFixed(3)}`;
}

export type SceneBlock = { top: string; left: string; right: string };

/** A slab: the top and the two side faces. */
export function sceneBlocks(nodes: SceneNode[] = NODES): SceneBlock[] {
  return nodes.map((n) => {
    const top = [
      iso(n.x - n.s, n.y - n.s, n.t),
      iso(n.x + n.s, n.y - n.s, n.t),
      iso(n.x + n.s, n.y + n.s, n.t),
      iso(n.x - n.s, n.y + n.s, n.t),
    ];
    const left = [
      iso(n.x - n.s, n.y + n.s, n.t),
      iso(n.x + n.s, n.y + n.s, n.t),
      iso(n.x + n.s, n.y + n.s, 0),
      iso(n.x - n.s, n.y + n.s, 0),
    ];
    const right = [
      iso(n.x + n.s, n.y - n.s, n.t),
      iso(n.x + n.s, n.y + n.s, n.t),
      iso(n.x + n.s, n.y + n.s, 0),
      iso(n.x + n.s, n.y - n.s, 0),
    ];
    return {
      top: top.map(point).join(' '),
      left: left.map(point).join(' '),
      right: right.map(point).join(' '),
    };
  });
}

/**
 * Wires are polylines, not curves, so `offset-distance` (packet) and dash offset (tail)
 * resolve to the same point; on a curve they disagree by pixels.
 */
const SEGMENTS = 48;

export type Polyline = { d: string; length: number; points: Point[] };

export function polyline(p0: Point, c: Point, p2: Point): Polyline {
  const points: Point[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    points.push([
      Number((u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0]).toFixed(3)),
      Number((u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]).toFixed(3)),
    ]);
  }
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const [head, ...rest] = points as [Point, ...Point[]];
  return {
    d: `M ${point(head)} ${rest.map((q) => `L ${point(q)}`).join(' ')}`,
    length,
    points,
  };
}

/** The point at a distance along the polyline, as the browser resolves it. */
export function pointAtDistance(points: Point[], distance: number): Point {
  const first = points[0] as Point;
  if (distance <= 0) return first;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (walked + step >= distance) {
      const t = step === 0 ? 0 : (distance - walked) / step;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += step;
  }
  return points[points.length - 1] as Point;
}

/** The wake: three overlapping dashes of different lengths, forming a taper. */
export const TAIL = [
  { span: 1, width: 0.026, opacity: 0.32 },
  { span: 0.58, width: 0.034, opacity: 0.46 },
  { span: 0.26, width: 0.044, opacity: 0.8 },
];

/** Tail length, capped so it never crosses a neighbouring wire; `PHASE` depends on it. */
export function tailSpan(length: number): number {
  return Math.min(length * 0.26, 0.65);
}

/** How far behind the packet's centre the tail ends, so it stays hidden under it. */
export const TAIL_LEAD = 0.05;

type TrailBand = {
  dash: string;
  from: string;
  to: string;
  width: number;
  opacity: number;
};

export type SceneLink = {
  d: string;
  points: Point[];
  length: number;
  end: Point;
  trail: TrailBand[];
  mid: Point;
  delay: string;
  /** The delay as a fraction of the cycle. */
  offset: number;
};

/** Each link is a lifted quadratic arc; its `d` is also the packet's `offset-path`. */
export function sceneLinks(phase: number[] = PHASE): SceneLink[] {
  return LINKS.map(([from, to], index) => {
    const a = NODES[from] as SceneNode;
    const b = NODES[to] as SceneNode;
    const start = iso(a.x, a.y, a.t);
    const end = iso(b.x, b.y, b.t);
    const control = iso((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(a.t, b.t) + 0.55);
    const { d, length, points } = polyline(start, control, end);
    const lit = tailSpan(length);
    // Becomes a negative CSS delay, which starts the animation part-way through.
    const offset = (phase[index] ?? index) / LINKS.length;
    return {
      d,
      points,
      length,
      end,
      trail: TAIL.map((band) => {
        const span = lit * band.span;
        const period = span + length;
        return {
          // A gap of the whole wire keeps the dash from wrapping, so the tail grows in.
          dash: `${span.toFixed(3)} ${length.toFixed(3)}`,
          // Lit run is `[d - span - lead, d - lead]`; lifted by a period to stay positive.
          from: (span + TAIL_LEAD + period).toFixed(3),
          to: (span + TAIL_LEAD - length + period).toFixed(3),
          width: band.width,
          opacity: band.opacity,
        };
      }),
      // B(0.5) of the curve, where a stopped packet parks.
      mid: [
        0.25 * start[0] + 0.5 * control[0] + 0.25 * end[0],
        0.25 * start[1] + 0.5 * control[1] + 0.25 * end[1],
      ],
      delay: `${(-offset * CYCLE).toFixed(3)}s`,
      offset,
    };
  });
}

/** The packet: a small block centred on z = 0 so it scales about itself. */
export const PACKET = (() => {
  const s = 0.062;
  const t = 0.048;
  const hi = t / 2;
  const lo = -t / 2;
  const face = (pts: [number, number, number][]) =>
    pts.map(([x, y, z]) => point(iso(x, y, z))).join(' ');
  return {
    top: face([
      [-s, -s, hi],
      [s, -s, hi],
      [s, s, hi],
      [-s, s, hi],
    ]),
    left: face([
      [-s, s, hi],
      [s, s, hi],
      [s, s, lo],
      [-s, s, lo],
    ]),
    right: face([
      [s, -s, hi],
      [s, s, hi],
      [s, s, lo],
      [s, -s, lo],
    ]),
  };
})();

/** On-screen radius of the packet including its halo. */
export const PACKET_RADIUS = 0.21;

/** The drawing's extent plus a margin. */
export function sceneViewBox(nodes: SceneNode[] = NODES): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const n of nodes) {
    for (const dx of [-n.s, n.s]) {
      for (const dy of [-n.s, n.s]) {
        for (const z of [0, n.t + 0.55]) {
          const [px, py] = iso(n.x + dx, n.y + dy, z);
          xs.push(px);
          ys.push(py);
        }
      }
    }
  }
  const pad = 0.6;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return `${minX.toFixed(2)} ${minY.toFixed(2)} ${(Math.max(...xs) + pad - minX).toFixed(2)} ${(Math.max(...ys) + pad - minY).toFixed(2)}`;
}

/** Opacity envelopes as `[fraction, opacity]` stops. Must match the stylesheet. */
export const PACKET_FADE: [number, number][] = [
  [0, 0],
  [0.08, 0.16],
  [0.18, 1],
  [0.85, 1],
  [1, 0],
];

export const TRAIL_FADE: [number, number][] = [
  [0, 0],
  [0.2, 1],
  [0.8, 1],
  [0.88, 0],
  [1, 0],
];

/** A linear-interpolated CSS keyframe list, read at a fraction of the period. */
export function fadeAt(stops: [number, number][], at: number): number {
  const t = ((at % 1) + 1) % 1;
  for (let i = 1; i < stops.length; i++) {
    const [x0, y0] = stops[i - 1] as [number, number];
    const [x1, y1] = stops[i] as [number, number];
    if (t <= x1) {
      const span = x1 - x0;
      return span === 0 ? y1 : y0 + ((t - x0) / span) * (y1 - y0);
    }
  }
  return (stops[stops.length - 1] as [number, number])[1];
}

/** The travel easing, `cubic-bezier(0.45, 0, 0.55, 1)`, as in the stylesheet. */
export function travelEase(t: number): number {
  // Newton on x(u) = 3(1-u)^2 u x1 + 3(1-u) u^2 x2 + u^3, with x1 = 0.45, x2 = 0.55.
  const x1 = 0.45;
  const x2 = 0.55;
  const bezier = (u: number, a: number, b: number) =>
    3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  let u = t;
  for (let i = 0; i < 12; i++) {
    const x = bezier(u, x1, x2) - t;
    const slope = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(slope) < 1e-9) break;
    u -= x / slope;
  }
  return bezier(Math.min(1, Math.max(0, u)), 0, 1);
}
