import {
  COLOR_ROLES,
  parseTokenRef,
  type ThemeDesign,
  type TokenGroup,
  TYPE_STEPS,
} from '@manablox/site';
import { resolveColor } from './color';

/** One choice of a token picker. */
export interface TokenOption {
  /** The reference, e.g. `space:4`. */
  value: string;
  label: string;
  /** The token's value, e.g. `1rem`, shown beside the label. */
  hint?: string | undefined;
  /** A CSS color for the swatch, colors only. */
  swatch?: string | undefined;
}

const ROLE_LABELS: Record<string, string> = {
  bg: 'Background',
  surface: 'Surface',
  text: 'Text',
  muted: 'Muted',
  primary: 'Primary',
  onPrimary: 'On primary',
  border: 'Border',
  accent: 'Accent',
};

export const colorRoleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

/** Sorts `2`, `10`, `sm`, `md` in a sensible order: numbers first, by value. */
const byScale = (a: string, b: string) => {
  const [na, nb] = [Number(a), Number(b)];
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  const order = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];
  return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b);
};

const entries = (group: string, record: Record<string, string> | undefined): TokenOption[] =>
  Object.entries(record ?? {})
    .sort(([a], [b]) => byScale(a, b))
    .map(([name, value]) => ({ value: `${group}:${name}`, label: name, hint: value }));

/** Every token of a group in the theme, as picker options. */
export function tokenOptions(theme: ThemeDesign, group: TokenGroup): TokenOption[] {
  switch (group) {
    case 'color':
      return [
        ...COLOR_ROLES.map((role) => ({
          value: `color:${role}`,
          label: colorRoleLabel(role),
          swatch: resolveColor(theme.colors, role) ?? undefined,
        })),
        ...Object.entries(theme.colors.palette).map(([name, value]) => ({
          value: `color:${name}`,
          label: name,
          hint: value,
          swatch: value,
        })),
      ];
    case 'space':
      return entries('space', theme.space);
    case 'radius':
      return entries('radius', theme.radius);
    case 'shadow':
      return entries('shadow', theme.shadow);
    case 'container':
      return entries('container', theme.container.widths);
    case 'type':
      return TYPE_STEPS.map((step) => ({
        value: `type:${step}`,
        label: step,
        hint: theme.type[step]?.size,
      }));
    case 'font':
      return [
        { value: 'font:body', label: 'Body font' },
        { value: 'font:heading', label: 'Heading font' },
        { value: 'font:mono', label: 'Monospace font' },
        ...theme.fonts.families.map((family) => ({
          value: `font:${family.id}`,
          label: family.name,
        })),
      ];
  }
}

/** A color reference with its opacity split off: `color:primary/50` -> `color:primary`, 50. */
export function splitColorRef(value: string | undefined): { ref: string; alpha: number } {
  const parts = parseTokenRef(value);
  if (parts?.group !== 'color') return { ref: '', alpha: 100 };
  return { ref: `color:${parts.name}`, alpha: parts.alpha ?? 100 };
}

/** Joins a color reference and an opacity; full opacity drops the suffix. */
export function joinColorRef(ref: string, alpha: number): string {
  if (!ref) return '';
  const rounded = Math.round(Math.min(100, Math.max(0, alpha)));
  return rounded >= 100 ? ref : `${ref}/${rounded}`;
}

/** The CSS color a color reference shows in a scheme, opacity applied; for swatches. */
export function colorRefCss(
  theme: ThemeDesign,
  value: string | undefined,
  scheme: 'light' | 'dark' = 'light',
): string | null {
  const parts = parseTokenRef(value);
  if (parts?.group !== 'color') return null;
  const base = resolveColor(theme.colors, parts.name, scheme);
  if (!base) return null;
  if (parts.alpha === undefined || parts.alpha >= 100) return base;
  return `color-mix(in srgb, ${base} ${parts.alpha}%, transparent)`;
}
