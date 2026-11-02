import {
  CONTAINER_WIDTHS,
  headingDefaults,
  SPACE_SCALE,
  type StarterTheme,
  typeScale,
} from './base.js';
import { bundledFont } from './fonts.js';

/** Warm paper tones and a serif for reading; made for articles and blogs. */
export const editorialTheme: StarterTheme = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Warm paper tones and a classic serif, made for long reads and blogs.',
  category: 'personal',
  theme: {
    colors: {
      palette: {
        paper: '#fbf8f3',
        cream: '#f3ede3',
        sand: '#e4dccd',
        ink: '#1f1b16',
        stone: '#6b6257',
        claret: '#9f1d35',
        rose: '#e0a3ae',
        charcoal: '#171411',
      },
      roles: {
        bg: 'paper',
        surface: 'cream',
        text: 'ink',
        muted: 'stone',
        primary: 'claret',
        onPrimary: 'paper',
        border: 'sand',
        accent: 'claret',
      },
      dark: {
        bg: 'charcoal',
        surface: '#221e1a',
        text: 'cream',
        muted: '#a89f93',
        primary: 'rose',
        onPrimary: 'charcoal',
        border: '#3a332c',
        accent: 'rose',
      },
    },
    fonts: {
      families: [
        bundledFont('source-serif-4'),
        bundledFont('inter'),
        bundledFont('jetbrains-mono'),
      ],
      roles: { body: 'source-serif-4', heading: 'source-serif-4', mono: 'jetbrains-mono' },
    },
    type: typeScale(1.2, 600),
    headings: headingDefaults(),
    body: { type: 'lg', font: 'body' },
    space: { ...SPACE_SCALE },
    radius: { none: '0px', sm: '0.125rem', md: '0.25rem', lg: '0.5rem', full: '9999px' },
    shadow: {
      sm: '0 1px 2px rgb(31 27 22 / 0.06)',
      md: '0 2px 8px rgb(31 27 22 / 0.08)',
      lg: '0 8px 24px rgb(31 27 22 / 0.1)',
    },
    container: {
      widths: { ...CONTAINER_WIDTHS, md: '44rem' },
      default: 'md',
      gutter: 'space:5',
    },
    elements: {
      link: {
        base: { color: 'color:primary', textDecoration: 'underline' },
        hover: { color: 'color:text' },
      },
      button: {
        base: {
          paddingX: 'space:5',
          paddingY: 'space:2',
          radius: 'radius:sm',
          font: 'font:inter',
          type: 'type:sm',
          fontWeight: 600,
          textTransform: 'uppercase',
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
          hover: { background: 'color:text', borderColor: 'color:text' },
        },
        secondary: {
          base: { color: 'color:text', borderColor: 'color:text' },
          hover: { background: 'color:text', color: 'color:bg' },
        },
        ghost: {
          base: { color: 'color:primary', borderColor: 'color:primary/0' },
          hover: { textDecoration: 'underline' },
        },
      },
      input: {
        base: {
          paddingX: 'space:3',
          paddingY: 'space:2',
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'color:border',
          background: 'color:bg',
          radius: 'radius:sm',
        },
        focus: { borderColor: 'color:primary' },
      },
      label: { base: { font: 'font:inter', type: 'type:sm', fontWeight: 600 } },
      prose: { base: { maxWidth: 'container:md' } },
    },
  },
  menus: {
    main: {
      preset: 'bar',
      depth: 1,
      levels: [
        {
          list: { base: { gap: 'space:6' } },
          link: {
            base: {
              font: 'font:inter',
              type: 'type:sm',
              textTransform: 'uppercase',
              color: 'color:text',
              textDecoration: 'none',
            },
            hover: { color: 'color:primary' },
          },
          current: { color: 'color:primary' },
        },
      ],
      mobile: {
        behaviour: 'offcanvas',
        breakpoint: 'mobile',
        label: { en: 'Menu' },
        panel: { base: { background: 'color:surface', padding: 'space:6' } },
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
  },
};
