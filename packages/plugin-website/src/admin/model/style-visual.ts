import type { StylePropName } from '@manablox/site';

/** What the visual style controls read and write, on the inspector's current rule. */
export interface StyleEditor {
  value: (prop: StylePropName) => unknown;
  /** The value an unset prop falls back to from a larger screen or the normal state. */
  inherited: (prop: StylePropName) => unknown;
  set: (prop: StylePropName, value: unknown) => void;
  /** Several props in one change, so undo takes them back together. */
  patch: (values: Partial<Record<StylePropName, unknown>>) => void;
}

/** A CSS length in pixels, for drawing scales; `null` when it is not a plain length. */
export function lengthPx(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === 'rem' || match[2] === 'em' ? amount * 16 : amount;
}

export type BoxKind = 'padding' | 'margin';
export type BoxSide = 'top' | 'right' | 'bottom' | 'left';
/** How far a spacing change reaches: one side, the side and its opposite, or all four. */
export type BoxScope = 'side' | 'axis' | 'all';

const SIDE_NAME: Record<BoxSide, 'Top' | 'Right' | 'Bottom' | 'Left'> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};
const AXIS: Record<BoxSide, 'X' | 'Y'> = { top: 'Y', bottom: 'Y', left: 'X', right: 'X' };
const AXIS_SIDES = { X: ['left', 'right'], Y: ['top', 'bottom'] } as const;

const prop = (name: string) => name as StylePropName;

/** The prop a scope writes for a side, e.g. `paddingY` for the top at `axis`. */
export function boxProp(kind: BoxKind, side: BoxSide, scope: BoxScope): StylePropName {
  if (scope === 'all') return prop(kind);
  if (scope === 'axis') return prop(`${kind}${AXIS[side]}`);
  return prop(`${kind}${SIDE_NAME[side]}`);
}

/**
 * The value that reaches one side and the scope it comes from; the site writes the sides
 * after the axes after the shorthand, so the most specific set prop wins.
 */
export function boxSide(
  read: (prop: StylePropName) => unknown,
  kind: BoxKind,
  side: BoxSide,
): { value: string | undefined; scope: BoxScope | null } {
  for (const scope of ['side', 'axis', 'all'] as const) {
    const value = read(boxProp(kind, side, scope));
    if (typeof value === 'string') return { value, scope };
  }
  return { value: undefined, scope: null };
}

/**
 * The props one spacing change writes: the chosen one gets the value, and the more
 * specific props it covers are cleared, so the change shows on every side it names.
 */
export function boxPatch(
  kind: BoxKind,
  side: BoxSide,
  scope: BoxScope,
  value: string | undefined,
): Partial<Record<StylePropName, unknown>> {
  const out: Partial<Record<StylePropName, unknown>> = { [boxProp(kind, side, scope)]: value };
  const sides: readonly BoxSide[] =
    scope === 'all'
      ? ['top', 'right', 'bottom', 'left']
      : scope === 'axis'
        ? AXIS_SIDES[AXIS[side]]
        : [];
  for (const covered of sides) out[boxProp(kind, covered, 'side')] = undefined;
  if (scope === 'all') {
    out[prop(`${kind}X`)] = undefined;
    out[prop(`${kind}Y`)] = undefined;
  }
  return out;
}

/** What a scope covers, in words, for a side. */
export function scopeLabel(side: BoxSide, scope: BoxScope): string {
  if (scope === 'all') return 'All sides';
  if (scope === 'axis') return AXIS[side] === 'Y' ? 'Top and bottom' : 'Left and right';
  return `${SIDE_NAME[side]} only`;
}

/** A scope's label short enough for a tile. */
export function scopeShortLabel(side: BoxSide, scope: BoxScope): string {
  if (scope === 'all') return 'All sides';
  if (scope === 'axis') return AXIS[side] === 'Y' ? 'Top + bottom' : 'Left + right';
  return SIDE_NAME[side];
}

/** The sides a scope reaches from a side. */
export function scopeSides(side: BoxSide, scope: BoxScope): readonly BoxSide[] {
  if (scope === 'all') return ['top', 'right', 'bottom', 'left'];
  return scope === 'axis' ? AXIS_SIDES[AXIS[side]] : [side];
}

/** Row or column, whatever the direction's reverse. */
export const mainAxis = (direction: unknown): 'row' | 'column' =>
  typeof direction === 'string' && direction.startsWith('column') ? 'column' : 'row';
