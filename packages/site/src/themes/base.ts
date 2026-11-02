import type {
  HeadingLevel,
  MenuDesign,
  TextDefaults,
  ThemeDesign,
  TypeScaleEntry,
  TypeStep,
} from '../types.js';

export const SPACE_SCALE: Record<string, string> = {
  '0': '0px',
  '1': '0.25rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
  '20': '5rem',
  '24': '6rem',
};

export const CONTAINER_WIDTHS: Record<string, string> = {
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
};

export function typeScale(ratio: number, headingWeight: number): Record<TypeStep, TypeScaleEntry> {
  const step = (power: number) => Math.round(ratio ** power * 1000) / 1000;
  const entry = (power: number, lineHeight: number, weight: number): TypeScaleEntry => {
    const size = step(power);
    const mobile = power > 2 ? Math.round((1 + (size - 1) * 0.7) * 1000) / 1000 : size;
    return {
      size: `${size}rem`,
      ...(mobile !== size ? { mobileSize: `${mobile}rem` } : {}),
      lineHeight,
      weight,
      ...(power >= 3 ? { letterSpacing: '-0.01em' } : {}),
    };
  };
  return {
    xs: entry(-2, 1.5, 400),
    sm: entry(-1, 1.5, 400),
    base: entry(0, 1.6, 400),
    lg: entry(1, 1.5, 400),
    xl: entry(2, 1.4, headingWeight),
    '2xl': entry(3, 1.3, headingWeight),
    '3xl': entry(4, 1.2, headingWeight),
    '4xl': entry(5, 1.1, headingWeight),
  };
}

export function headingDefaults(
  overrides: Partial<TextDefaults> = {},
): Record<HeadingLevel, TextDefaults> {
  const level = (type: TypeStep): TextDefaults => ({ type, font: 'heading', ...overrides });
  return {
    h1: level('4xl'),
    h2: level('3xl'),
    h3: level('2xl'),
    h4: level('xl'),
    h5: level('lg'),
    h6: level('base'),
  };
}

/** Gallery groups of the built-in themes, in order. */
export const THEME_CATEGORIES = [
  { id: 'professional', label: 'Professional', hint: 'Companies, services and organisations' },
  { id: 'creative', label: 'Creative', hint: 'Studios, products, portfolios and events' },
  { id: 'personal', label: 'Personal', hint: 'Blogs, journals and personal pages' },
] as const;

export type ThemeCategory = (typeof THEME_CATEGORIES)[number]['id'];

export interface StarterTheme {
  id: string;
  name: string;
  description: string;
  category: ThemeCategory;
  theme: ThemeDesign;
  /** Menu designs by menu design key. */
  menus: Record<string, MenuDesign>;
}
