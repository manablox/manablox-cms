import type { StyleProps, ThemeDesign } from '@manablox/site';

/** Root font size the canvas renders with. */
const REM = 16;

/** A size token's value in pixels; `null` for relative or unknown units. */
export function sizeToPx(value: string | undefined): number | null {
  const match = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value?.trim() ?? '');
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 'px' ? amount : amount * REM;
}

/** The entry of `values` closest to `px`. */
function nearest(
  values: Record<string, string>,
  px: number,
): { name: string; value: string } | null {
  let best: { name: string; value: string; distance: number } | null = null;
  for (const [name, value] of Object.entries(values)) {
    const size = sizeToPx(value);
    if (size === null || size <= 0) continue;
    const distance = Math.abs(size - px);
    if (!best || distance < best.distance) best = { name, value, distance };
  }
  return best ? { name: best.name, value: best.value } : null;
}

/** How far off a container width may be and still be picked. */
const TOLERANCE = 0.15;

/** Pixels as rem in half steps. */
const remSize = (px: number) => `${Math.max(0.5, Math.round((px / REM) * 2) / 2)}rem`;

/** Pixels rounded to a 4px step. */
const rawPx = (px: number) => `${Math.max(4, Math.round(px / 4) * 4)}px`;

/**
 * Style props for a resize on the canvas. The default snaps the width to a container width
 * when one is close, else to half rem steps (as a max width), and the height to the nearest
 * spacing step (as a minimum height); `advanced` keeps raw pixels in 4px steps.
 */
export function resizeStyle(
  size: { width?: number | undefined; height?: number | undefined },
  theme: ThemeDesign,
  advanced: boolean,
): Partial<StyleProps> {
  const out: Partial<StyleProps> = {};
  if (size.width !== undefined && size.width > 0) {
    if (advanced) out.width = rawPx(size.width);
    else {
      const container = nearest(theme.container?.widths ?? {}, size.width);
      const close =
        container &&
        Math.abs((sizeToPx(container.value) ?? 0) - size.width) <= size.width * TOLERANCE;
      out.maxWidth = container && close ? `container:${container.name}` : remSize(size.width);
    }
  }
  if (size.height !== undefined && size.height > 0) {
    if (advanced) out.minHeight = rawPx(size.height);
    else {
      const step = nearest(theme.space ?? {}, size.height);
      out.minHeight = step?.value ?? rawPx(size.height);
    }
  }
  return out;
}
