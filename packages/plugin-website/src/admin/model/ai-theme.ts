import { plainClone } from '@manablox/admin-sdk';
import { COLOR_ROLES, type ThemeDesign } from '@manablox/site';
import { type ContrastCheck, checkContrast, resolveColor } from './color';
import { colorRoleLabel } from './tokens';

/** The parts of a theme an AI proposal sets; the rest stays as the editor has it. */
const AI_THEME_KEYS = ['colors', 'fonts', 'type', 'headings', 'radius', 'shadow'] as const;

/** `current` with the proposal's colors, fonts, type scale, radius and shadows. */
export function mergeAiTheme(current: ThemeDesign, proposed: ThemeDesign): ThemeDesign {
  const next = { ...current };
  for (const key of AI_THEME_KEYS) Object.assign(next, { [key]: plainClone(proposed[key]) });
  return next;
}

/** A role's swatch for a preview. */
export interface RoleSwatch {
  role: string;
  label: string;
  color: string | null;
}

export function roleSwatches(theme: ThemeDesign): RoleSwatch[] {
  return COLOR_ROLES.map((role) => ({
    role,
    label: colorRoleLabel(role),
    color: resolveColor(theme.colors, role),
  }));
}

/** Text pairs below WCAG AA, in both schemes; borders may stay subtle. */
export function contrastProblems(theme: ThemeDesign): Array<ContrastCheck & { dark: boolean }> {
  const light = checkContrast(theme.colors).map((check) => ({ ...check, dark: false }));
  const dark = theme.colors.dark
    ? checkContrast(theme.colors, 'dark').map((check) => ({ ...check, dark: true }))
    : [];
  return [...light, ...dark].filter((check) => check.needs === 'aa' && check.ok === false);
}

/** A family's CSS stack for a font role, for previews in the admin. */
export function fontStack(theme: ThemeDesign, role: 'heading' | 'body'): string {
  const family = theme.fonts.families.find((entry) => entry.id === theme.fonts.roles[role]);
  return family ? `"${family.name}", ${family.fallback}` : 'inherit';
}
