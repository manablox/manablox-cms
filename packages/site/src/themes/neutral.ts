import {
  CONTAINER_WIDTHS,
  headingDefaults,
  SPACE_SCALE,
  type StarterTheme,
  typeScale,
} from './base.js';
import { bundledFont } from './fonts.js';

/** Calm grays with a blue accent; Inter throughout. */
export const neutralTheme: StarterTheme = {
  id: 'neutral',
  name: 'Neutral',
  description: 'Calm grays, a blue accent and one clean sans-serif. Fits almost any site.',
  category: 'professional',
  theme: {
    colors: {
      palette: {
        white: '#ffffff',
        gray50: '#f8fafc',
        gray100: '#f1f5f9',
        gray200: '#e2e8f0',
        gray500: '#64748b',
        gray700: '#334155',
        gray900: '#0f172a',
        blue600: '#2563eb',
        blue400: '#60a5fa',
        amber500: '#f59e0b',
      },
      roles: {
        bg: 'white',
        surface: 'gray50',
        text: 'gray900',
        muted: 'gray500',
        primary: 'blue600',
        onPrimary: 'white',
        border: 'gray200',
        accent: 'amber500',
      },
      dark: {
        bg: 'gray900',
        surface: '#1e293b',
        text: 'gray100',
        muted: '#94a3b8',
        primary: 'blue400',
        onPrimary: 'gray900',
        border: 'gray700',
      },
    },
    fonts: {
      families: [bundledFont('inter'), bundledFont('jetbrains-mono')],
      roles: { body: 'inter', heading: 'inter', mono: 'jetbrains-mono' },
    },
    type: typeScale(1.25, 700),
    headings: headingDefaults(),
    body: { type: 'base', font: 'body' },
    space: { ...SPACE_SCALE },
    radius: { none: '0px', sm: '0.25rem', md: '0.5rem', lg: '0.75rem', full: '9999px' },
    shadow: {
      sm: '0 1px 2px rgb(15 23 42 / 0.06)',
      md: '0 4px 12px rgb(15 23 42 / 0.08)',
      lg: '0 12px 32px rgb(15 23 42 / 0.12)',
    },
    container: { widths: { ...CONTAINER_WIDTHS }, default: 'lg', gutter: 'space:4' },
    elements: {
      link: { base: { color: 'color:primary', textDecoration: 'underline' } },
      button: {
        base: {
          paddingX: 'space:5',
          paddingY: 'space:3',
          radius: 'radius:md',
          fontWeight: 600,
          borderWidth: '1px',
          borderStyle: 'solid',
        },
      },
      buttons: {
        primary: {
          base: {
            background: 'color:primary',
            color: 'color:onPrimary',
            borderColor: 'color:primary',
          },
          hover: { background: 'color:primary/85' },
        },
        secondary: {
          base: { background: 'color:surface', color: 'color:text', borderColor: 'color:border' },
          hover: { borderColor: 'color:muted' },
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
          radius: 'radius:md',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'color:border',
          background: 'color:bg',
        },
        focus: { borderColor: 'color:primary' },
      },
      label: { base: { fontWeight: 600, type: 'type:sm' } },
    },
  },
  menus: {
    main: {
      preset: 'dropdown',
      depth: 2,
      levels: [
        {
          list: { base: { gap: 'space:6' } },
          link: {
            base: { color: 'color:text', textDecoration: 'none', fontWeight: 500 },
            hover: { color: 'color:primary' },
          },
          current: { color: 'color:primary' },
        },
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
      ],
      mobile: {
        behaviour: 'burger',
        breakpoint: 'tablet',
        label: { en: 'Menu' },
        panel: { base: { background: 'color:bg', padding: 'space:4' } },
      },
    },
    footer: {
      preset: 'columns',
      depth: 2,
      levels: [
        { link: { base: { color: 'color:text', fontWeight: 600, textDecoration: 'none' } } },
        {
          link: {
            base: { color: 'color:muted', textDecoration: 'none' },
            hover: { color: 'color:text' },
          },
        },
      ],
      mobile: { behaviour: 'none', breakpoint: 'mobile' },
    },
  },
};
