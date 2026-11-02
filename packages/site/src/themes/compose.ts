import type {
  ColorRole,
  ColorValue,
  MenuDesign,
  StyleProps,
  TextDefaults,
  ThemeDesign,
  TypeStep,
} from '../types.js';
import {
  CONTAINER_WIDTHS,
  headingDefaults,
  SPACE_SCALE,
  type StarterTheme,
  type ThemeCategory,
  typeScale,
} from './base.js';
import { bundledFont } from './fonts.js';

/** The choices that set one starter theme apart; the rest is shared. */
export interface ThemeSpec {
  id: string;
  name: string;
  description: string;
  category: ThemeCategory;
  palette: Record<string, ColorValue>;
  roles: Record<ColorRole, ColorValue>;
  dark: Partial<Record<ColorRole, ColorValue>>;
  /** Bundled font ids. */
  fonts: { heading: string; body: string };
  /** Type scale ratio and heading weight. */
  scale: [ratio: number, headingWeight: number];
  headings?: Partial<TextDefaults>;
  bodyType?: TypeStep;
  radius: { sm: string; md: string; lg: string };
  /** `r g b` of the shadow color; `hard` draws offset shadows without blur. */
  shadow: { rgb: string; hard?: boolean };
  container?: { default: string; gutter: `space:${string}` };
  button: {
    radius: 'radius:none' | 'radius:sm' | 'radius:md' | 'radius:lg' | 'radius:full';
    weight: NonNullable<StyleProps['fontWeight']>;
    uppercase?: boolean;
    border?: string;
  };
  link?: { decoration: 'underline' | 'none'; hover?: `color:${string}` };
  menu: {
    preset: 'bar' | 'dropdown';
    uppercase?: boolean;
    weight?: NonNullable<StyleProps['fontWeight']>;
    gap?: `space:${string}`;
  };
}

function shadows({ rgb, hard }: ThemeSpec['shadow']): Record<string, string> {
  if (hard) {
    return {
      sm: `2px 2px 0 rgb(${rgb})`,
      md: `4px 4px 0 rgb(${rgb})`,
      lg: `8px 8px 0 rgb(${rgb})`,
    };
  }
  return {
    sm: `0 1px 2px rgb(${rgb} / 0.06)`,
    md: `0 4px 12px rgb(${rgb} / 0.08)`,
    lg: `0 12px 32px rgb(${rgb} / 0.12)`,
  };
}

function elements(spec: ThemeSpec): ThemeDesign['elements'] {
  const border = spec.button.border ?? '1px';
  const button: ThemeDesign['elements']['button'] = {
    base: {
      paddingX: 'space:5',
      paddingY: 'space:3',
      radius: spec.button.radius,
      fontWeight: spec.button.weight,
      borderWidth: border,
      borderStyle: 'solid',
      ...(spec.button.uppercase ? { textTransform: 'uppercase', type: 'type:sm' } : {}),
    },
  };
  return {
    link: {
      base: { color: 'color:primary', textDecoration: spec.link?.decoration ?? 'underline' },
      hover: spec.link?.hover
        ? { color: spec.link.hover }
        : { color: 'color:text', textDecoration: 'underline' },
    },
    button,
    buttons: {
      primary: {
        base: {
          background: 'color:primary',
          color: 'color:onPrimary',
          borderColor: 'color:primary',
        },
        hover: { background: 'color:primary/85', borderColor: 'color:primary/85' },
      },
      secondary: {
        base: { background: 'color:surface', color: 'color:text', borderColor: 'color:border' },
        hover: { borderColor: 'color:text' },
      },
      ghost: {
        base: { color: 'color:primary', borderColor: 'color:primary/0' },
        hover: { background: 'color:primary/10' },
      },
    },
    input: {
      base: {
        paddingX: 'space:3',
        paddingY: 'space:2',
        radius: spec.button.radius === 'radius:full' ? 'radius:md' : spec.button.radius,
        borderWidth: border,
        borderStyle: 'solid',
        borderColor: 'color:border',
        background: 'color:bg',
      },
      focus: { borderColor: 'color:primary' },
    },
    label: { base: { fontWeight: 600, type: 'type:sm' } },
  };
}

function menus(spec: ThemeSpec): Record<string, MenuDesign> {
  const text: StyleProps = {
    color: 'color:text',
    textDecoration: 'none',
    fontWeight: spec.menu.weight ?? 500,
    ...(spec.menu.uppercase ? ({ textTransform: 'uppercase', type: 'type:sm' } as const) : {}),
  };
  const dropdown = spec.menu.preset === 'dropdown';
  return {
    main: {
      preset: spec.menu.preset,
      depth: dropdown ? 2 : 1,
      levels: [
        {
          list: { base: { gap: spec.menu.gap ?? 'space:6' } },
          link: { base: text, hover: { color: 'color:primary' } },
          current: { color: 'color:primary' },
        },
        ...(dropdown
          ? ([
              {
                list: {
                  base: {
                    background: 'color:bg',
                    padding: 'space:2',
                    radius: 'radius:md',
                    shadow: 'shadow:md',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: 'color:border',
                  },
                },
                link: {
                  base: { paddingX: 'space:3', paddingY: 'space:2', color: 'color:text' },
                  hover: { background: 'color:surface' },
                },
              },
            ] satisfies MenuDesign['levels'])
          : []),
      ],
      mobile: {
        behaviour: dropdown ? 'burger' : 'offcanvas',
        breakpoint: 'tablet',
        label: { en: 'Menu' },
        panel: { base: { background: 'color:bg', padding: 'space:6' } },
      },
    },
    footer: {
      preset: 'list',
      depth: 1,
      levels: [
        {
          list: { base: { gap: 'space:2' } },
          link: {
            base: { color: 'color:muted', textDecoration: 'none' },
            hover: { color: 'color:text' },
          },
        },
      ],
      mobile: { behaviour: 'none', breakpoint: 'mobile' },
    },
  };
}

/** A starter theme from its spec, with the shared scales, elements and menus. */
export function composeTheme(spec: ThemeSpec): StarterTheme {
  const ids = [...new Set([spec.fonts.heading, spec.fonts.body, 'jetbrains-mono'])];
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    theme: {
      colors: { palette: spec.palette, roles: spec.roles, dark: spec.dark },
      fonts: {
        families: ids.map(bundledFont),
        roles: { body: spec.fonts.body, heading: spec.fonts.heading, mono: 'jetbrains-mono' },
      },
      type: typeScale(...spec.scale),
      headings: headingDefaults(spec.headings),
      body: { type: spec.bodyType ?? 'base', font: 'body' },
      space: { ...SPACE_SCALE },
      radius: { none: '0px', ...spec.radius, full: '9999px' },
      shadow: shadows(spec.shadow),
      container: {
        widths: { ...CONTAINER_WIDTHS },
        default: spec.container?.default ?? 'lg',
        gutter: spec.container?.gutter ?? 'space:5',
      },
      elements: elements(spec),
    },
    menus: menus(spec),
  };
}
