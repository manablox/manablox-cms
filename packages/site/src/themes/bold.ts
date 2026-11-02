import {
  CONTAINER_WIDTHS,
  headingDefaults,
  SPACE_SCALE,
  type StarterTheme,
  typeScale,
} from './base.js';
import { bundledFont } from './fonts.js';

/** High contrast, big type and a bright accent; for products and campaigns. */
export const boldTheme: StarterTheme = {
  id: 'bold',
  name: 'Bold',
  description: 'High contrast, big headlines and a bright accent for products and campaigns.',
  category: 'creative',
  theme: {
    colors: {
      palette: {
        black: '#0a0a0a',
        night: '#161616',
        white: '#ffffff',
        smoke: '#f4f4f0',
        steel: '#5c5c5c',
        lime: '#c6f432',
        violet: '#6d28d9',
        line: '#dcdcd4',
      },
      roles: {
        bg: 'white',
        surface: 'smoke',
        text: 'black',
        muted: 'steel',
        primary: 'black',
        onPrimary: 'lime',
        border: 'line',
        accent: 'lime',
      },
      dark: {
        bg: 'black',
        surface: 'night',
        text: 'smoke',
        muted: '#a3a3a3',
        primary: 'lime',
        onPrimary: 'black',
        border: '#2e2e2e',
      },
    },
    fonts: {
      families: [bundledFont('space-grotesk'), bundledFont('inter'), bundledFont('jetbrains-mono')],
      roles: { body: 'inter', heading: 'space-grotesk', mono: 'jetbrains-mono' },
    },
    type: typeScale(1.333, 700),
    headings: headingDefaults({ weight: 700 }),
    body: { type: 'base', font: 'body' },
    space: { ...SPACE_SCALE },
    radius: { none: '0px', sm: '0.5rem', md: '1rem', lg: '1.5rem', full: '9999px' },
    shadow: {
      sm: '0 2px 0 rgb(10 10 10)',
      md: '0 4px 0 rgb(10 10 10)',
      lg: '0 8px 0 rgb(10 10 10)',
    },
    container: { widths: { ...CONTAINER_WIDTHS }, default: 'xl', gutter: 'space:6' },
    elements: {
      link: {
        base: { color: 'color:text', textDecoration: 'underline' },
        hover: { color: 'color:violet' },
      },
      button: {
        base: {
          paddingX: 'space:6',
          paddingY: 'space:3',
          radius: 'radius:full',
          fontWeight: 700,
          borderWidth: '2px',
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
          hover: { shadow: 'shadow:md' },
          active: { shadow: 'none' },
        },
        secondary: {
          base: { background: 'color:accent', color: 'color:black', borderColor: 'color:black' },
          hover: { shadow: 'shadow:md' },
        },
        ghost: {
          base: { color: 'color:text', borderColor: 'color:text' },
          hover: { background: 'color:text', color: 'color:bg' },
        },
      },
      input: {
        base: {
          paddingX: 'space:4',
          paddingY: 'space:3',
          radius: 'radius:sm',
          borderWidth: '2px',
          borderStyle: 'solid',
          borderColor: 'color:text',
          background: 'color:bg',
        },
        focus: { shadow: 'shadow:sm' },
      },
      label: { base: { fontWeight: 700, type: 'type:sm', textTransform: 'uppercase' } },
    },
  },
  menus: {
    main: {
      preset: 'mega',
      depth: 2,
      levels: [
        {
          list: { base: { gap: 'space:8' } },
          link: {
            base: { color: 'color:text', fontWeight: 700, textDecoration: 'none' },
            hover: { textDecoration: 'underline' },
          },
          current: { textDecoration: 'underline' },
        },
        {
          list: {
            base: { background: 'color:surface', padding: 'space:8', gap: 'space:4', columns: 3 },
          },
          link: {
            base: { color: 'color:text', textDecoration: 'none' },
            hover: { color: 'color:violet' },
          },
        },
      ],
      mobile: {
        behaviour: 'offcanvas',
        breakpoint: 'tablet',
        label: { en: 'Menu' },
        panel: { base: { background: 'color:accent', padding: 'space:8' } },
      },
    },
    footer: {
      preset: 'columns',
      depth: 2,
      levels: [
        { link: { base: { color: 'color:text', fontWeight: 700, textDecoration: 'none' } } },
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
