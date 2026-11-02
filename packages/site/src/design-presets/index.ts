import {
  THEME_BUNDLE_FORMAT,
  THEME_BUNDLE_VERSION,
  type ThemeBundle,
  type ThemeBundleDesign,
} from '../bundle.js';
import type { ThemeCategory } from '../themes/base.js';
import { presetBlock } from './blocks.js';
import type { PresetField, PresetType, Recipe } from './kit.js';
import {
  FOOTER_MENU_DESIGN,
  MAIN_MENU,
  presetFooterMenu,
  presetLayout,
  presetMainMenu,
} from './layout.js';
import type { Look } from './look.js';
import { presetPage } from './pages.js';

export type { PresetField, PresetType } from './kit.js';
export type { Look, Tone } from './look.js';

/** A complete site design: layout, menus, and block and page designs for known types. */
export interface DesignPreset {
  id: string;
  name: string;
  description: string;
  category: ThemeCategory;
  look: Look;
}

const SECTION: Look['rhythm'] = {
  section: ['space:24', 'space:16'],
  tight: ['space:16', 'space:12'],
};

const AIRY: Look['rhythm'] = {
  section: ['space:20', 'space:12'],
  tight: ['space:12', 'space:10'],
};

/** The built-in presets, grouped like the starter themes; the first of a category is its default. */
export const DESIGN_PRESETS: readonly DesignPreset[] = [
  {
    id: 'atlas',
    name: 'Atlas',
    description:
      'A confident company site: split hero, raised service cards, a dark footer and a bold call to action.',
    category: 'professional',
    look: {
      header: { kind: 'bar', tone: 'bg', border: true, strip: false, logo: {} },
      menu: { style: 'pill' },
      footer: { kind: 'columns', tone: 'ink' },
      hero: 'split',
      heroTone: 'bg',
      text: 'split',
      card: 'elevated',
      list: 'grid',
      quote: 'cards',
      cta: 'band',
      highlight: 'gradient',
      alternate: 'surface',
      kicker: 'bar',
      titles: { center: false },
      pageHeader: 'band',
      portraits: 'square',
      radius: 'radius:lg',
      columns: 3,
      media: '16/9',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'harbor',
    name: 'Harbor',
    description:
      'Calm and trustworthy: a colored hero band, centered headings, bordered cards and round team portraits.',
    category: 'professional',
    look: {
      header: { kind: 'split', tone: 'bg', border: true, strip: true, logo: {} },
      menu: { style: 'underline' },
      footer: { kind: 'columns', tone: 'surface' },
      hero: 'split',
      heroTone: 'primary',
      text: 'centered',
      card: 'bordered',
      list: 'grid',
      quote: 'cards',
      cta: 'panel',
      highlight: 'surface',
      alternate: 'surface',
      kicker: 'dot',
      titles: { center: true },
      pageHeader: 'band',
      portraits: 'round',
      radius: 'radius:md',
      columns: 3,
      media: '3/2',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'ledger',
    name: 'Ledger',
    description:
      'Precise and understated for firms and consultancies: a statement headline, services as rows, one quote at a time and square corners.',
    category: 'professional',
    look: {
      header: { kind: 'bar', tone: 'bg', border: true, strip: false, logo: { fontWeight: 600 } },
      menu: { style: 'plain' },
      footer: { kind: 'minimal', tone: 'bg' },
      hero: 'statement',
      heroTone: 'bg',
      text: 'ruled',
      card: 'plain',
      list: 'rows',
      quote: 'large',
      cta: 'outline',
      highlight: 'surface',
      alternate: 'bg',
      kicker: 'rule',
      titles: { weight: 500, center: false },
      pageHeader: 'plain',
      portraits: 'square',
      radius: '0',
      columns: 3,
      media: '3/2',
      reading: 'sm',
      rhythm: SECTION,
    },
  },
  {
    id: 'summit',
    name: 'Summit',
    description:
      'Modern and friendly for startups and organisations: a floating header, a hero panel, accent-topped cards and quotes beside a color bar.',
    category: 'professional',
    look: {
      header: { kind: 'floating', tone: 'bg', border: false, strip: false, logo: {} },
      menu: { style: 'pill' },
      footer: { kind: 'centered', tone: 'surface' },
      hero: 'panel',
      heroTone: 'bg',
      text: 'stacked',
      card: 'accent',
      list: 'grid',
      quote: 'bar',
      cta: 'band',
      highlight: 'gradient',
      alternate: 'surface',
      kicker: 'dot',
      titles: { weight: 700, center: false },
      pageHeader: 'gradient',
      portraits: 'round',
      radius: 'radius:lg',
      columns: 3,
      media: '16/9',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    description:
      'Loud and colorful: a huge headline on a gradient, big outlined project cards and a display footer.',
    category: 'creative',
    look: {
      header: {
        kind: 'bar',
        tone: 'bg',
        border: false,
        strip: true,
        logo: { textTransform: 'uppercase', fontWeight: 900 },
      },
      menu: { style: 'caps' },
      footer: { kind: 'display', tone: 'ink' },
      hero: 'display',
      heroTone: 'gradient',
      text: 'split',
      card: 'outlined',
      list: 'grid',
      quote: 'cards',
      cta: 'band',
      highlight: 'primary',
      alternate: 'surface',
      kicker: 'bar',
      titles: { weight: 800, uppercase: true, center: false },
      pageHeader: 'gradient',
      portraits: 'square',
      radius: 'radius:lg',
      columns: 2,
      media: '4/3',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'gallery',
    name: 'Gallery',
    description:
      'Quiet and image-led: a centered header, a picture edge to edge, tall plain cards and thin rules.',
    category: 'creative',
    look: {
      header: {
        kind: 'centered',
        tone: 'bg',
        border: true,
        strip: false,
        logo: { type: 'type:2xl' },
      },
      menu: { style: 'caps' },
      footer: { kind: 'minimal', tone: 'bg' },
      hero: 'fullbleed',
      heroTone: 'bg',
      text: 'stacked',
      card: 'plain',
      list: 'grid',
      quote: 'large',
      cta: 'outline',
      highlight: 'bg',
      alternate: 'bg',
      kicker: 'rule',
      titles: { weight: 400, center: true },
      pageHeader: 'plain',
      portraits: 'square',
      radius: '0',
      columns: 3,
      media: '3/4',
      reading: 'sm',
      rhythm: AIRY,
    },
  },
  {
    id: 'poster',
    name: 'Poster',
    description:
      'Swiss poster energy for agencies and events: huge uppercase statements, a boxed menu, hard outlined cards and square marks.',
    category: 'creative',
    look: {
      header: {
        kind: 'bar',
        tone: 'bg',
        border: true,
        strip: false,
        logo: { textTransform: 'uppercase', fontWeight: 900 },
      },
      menu: { style: 'boxed' },
      footer: { kind: 'display', tone: 'primary' },
      hero: 'statement',
      heroTone: 'bg',
      text: 'ruled',
      card: 'outlined',
      list: 'grid',
      quote: 'bar',
      cta: 'band',
      highlight: 'ink',
      alternate: 'surface',
      kicker: 'square',
      titles: { weight: 900, uppercase: true, center: false },
      pageHeader: 'plain',
      portraits: 'square',
      radius: '0',
      columns: 2,
      media: '4/3',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'stage',
    name: 'Stage',
    description:
      'Dark and dramatic for products, launches and events: an inverted header and hero, centered headlines and gradient highlights.',
    category: 'creative',
    look: {
      header: { kind: 'bar', tone: 'ink', border: false, strip: false, logo: { fontWeight: 800 } },
      menu: { style: 'pill' },
      footer: { kind: 'display', tone: 'ink' },
      hero: 'display',
      heroTone: 'ink',
      text: 'centered',
      card: 'accent',
      list: 'grid',
      quote: 'cards',
      cta: 'panel',
      highlight: 'gradient',
      alternate: 'surface',
      kicker: 'bar',
      titles: { weight: 800, center: true },
      pageHeader: 'gradient',
      portraits: 'round',
      radius: 'radius:md',
      columns: 3,
      media: '16/9',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'journal',
    name: 'Journal',
    description:
      'Made for reading: a centered masthead, a narrow text column, posts as rows and one quote at a time.',
    category: 'personal',
    look: {
      header: {
        kind: 'centered',
        tone: 'bg',
        border: true,
        strip: false,
        logo: { type: 'type:3xl' },
      },
      menu: { style: 'plain' },
      footer: { kind: 'centered', tone: 'surface' },
      hero: 'editorial',
      heroTone: 'bg',
      text: 'stacked',
      card: 'tinted',
      list: 'rows',
      quote: 'large',
      cta: 'panel',
      highlight: 'surface',
      alternate: 'bg',
      kicker: 'dot',
      titles: { center: true },
      pageHeader: 'plain',
      portraits: 'round',
      radius: 'radius:md',
      columns: 2,
      media: '3/2',
      reading: 'sm',
      rhythm: AIRY,
    },
  },
  {
    id: 'sunny',
    name: 'Sunny',
    description:
      'Friendly and personal: a round portrait beside a big hello, pill menu, soft cards and colored bands.',
    category: 'personal',
    look: {
      header: { kind: 'bar', tone: 'bg', border: false, strip: false, logo: {} },
      menu: { style: 'pill' },
      footer: { kind: 'centered', tone: 'surface' },
      hero: 'portrait',
      heroTone: 'bg',
      text: 'stacked',
      card: 'tinted',
      list: 'grid',
      quote: 'cards',
      cta: 'band',
      highlight: 'gradient',
      alternate: 'surface',
      kicker: 'dot',
      titles: { center: false },
      pageHeader: 'band',
      portraits: 'round',
      radius: 'radius:lg',
      columns: 3,
      media: '4/3',
      reading: 'md',
      rhythm: SECTION,
    },
  },
  {
    id: 'readme',
    name: 'Readme',
    description:
      'Plain and technical for developers and makers: a compact intro, a text index of work, bordered boxes and small square marks.',
    category: 'personal',
    look: {
      header: { kind: 'bar', tone: 'bg', border: true, strip: false, logo: { type: 'type:lg' } },
      menu: { style: 'underline' },
      footer: { kind: 'minimal', tone: 'bg' },
      hero: 'compact',
      heroTone: 'bg',
      text: 'ruled',
      card: 'bordered',
      list: 'index',
      quote: 'bar',
      cta: 'outline',
      highlight: 'surface',
      alternate: 'bg',
      kicker: 'square',
      titles: { weight: 700, center: false },
      pageHeader: 'plain',
      portraits: 'square',
      radius: 'radius:sm',
      columns: 2,
      media: '16/9',
      reading: 'sm',
      rhythm: { section: ['space:16', 'space:12'], tight: ['space:10', 'space:8'] },
    },
  },
  {
    id: 'postcard',
    name: 'Postcard',
    description:
      'Warm and playful for travel logs and personal pages: a floating header, a colorful hero panel with the photo first and italic headings.',
    category: 'personal',
    look: {
      header: { kind: 'floating', tone: 'bg', border: false, strip: false, logo: {} },
      menu: { style: 'pill' },
      footer: { kind: 'display', tone: 'surface' },
      hero: 'panel',
      heroTone: 'gradient',
      mirror: true,
      text: 'centered',
      card: 'elevated',
      list: 'grid',
      quote: 'cards',
      cta: 'band',
      highlight: 'primary',
      alternate: 'surface',
      kicker: 'none',
      titles: { weight: 700, italic: true, center: true },
      pageHeader: 'gradient',
      portraits: 'round',
      radius: 'radius:lg',
      columns: 2,
      media: '1/1',
      reading: 'md',
      rhythm: SECTION,
    },
  },
];

export function designPreset(id: string): DesignPreset | undefined {
  return DESIGN_PRESETS.find((entry) => entry.id === id);
}

/** The first preset of a theme's category, the one a new designed site starts with. */
export function defaultDesignPreset(category: ThemeCategory | null | undefined): DesignPreset {
  return (
    DESIGN_PRESETS.find((entry) => entry.category === category) ??
    (DESIGN_PRESETS[0] as DesignPreset)
  );
}

/** Field name to field name, sub-fields of repeaters included: bindings are written by name. */
function namePaths(fields: readonly PresetField[], prefix = '', depth = 0): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    out[path] = path;
    const sub = field.settings?.fields;
    if (field.type === 'repeater' && Array.isArray(sub) && depth < 3)
      Object.assign(
        out,
        namePaths(
          sub.filter(
            (entry): entry is PresetField =>
              typeof entry === 'object' && entry !== null && typeof entry.name === 'string',
          ),
          path,
          depth + 1,
        ),
      );
  }
  return out;
}

export interface DesignPresetInput {
  /** The space's types, by machine name; settings as stored. */
  types: readonly PresetType[];
  /** Static text is written in this locale, English and German included. */
  locale: string;
  /** Machine name of the header menu; `main` by default. */
  menu?: string | undefined;
}

/**
 * A preset as a theme bundle without a theme: the `default` layout, the `main` and `footer`
 * menu designs, and designs for the block and document types it knows. Bindings name fields,
 * so importing the bundle maps them onto the space's field ids.
 */
export function designPresetBundle(id: string, input: DesignPresetInput): ThemeBundle | null {
  const preset = designPreset(id);
  if (!preset) return null;
  const recipe: Recipe = { look: preset.look, locale: input.locale };
  const designs: ThemeBundleDesign[] = [
    {
      kind: 'layout',
      key: 'default',
      name: 'Default',
      data: presetLayout(recipe, input.menu ?? MAIN_MENU),
    },
    { kind: 'menu', key: 'main', name: 'Main menu', data: presetMainMenu(recipe) },
    { kind: 'menu', key: FOOTER_MENU_DESIGN, name: 'Footer menu', data: presetFooterMenu(recipe) },
  ];
  for (const type of input.types) {
    const ref = { name: type.name, fields: namePaths(type.fields) };
    if (type.kind === 'block') {
      const data = presetBlock(recipe, type);
      if (data) designs.push({ kind: 'block', key: type.name, type: ref, data });
    } else if (type.kind === 'content') {
      const data = presetPage(recipe, type, input.types);
      if (data) designs.push({ kind: 'page', key: type.name, type: ref, data });
    }
  }
  return {
    format: THEME_BUNDLE_FORMAT,
    version: THEME_BUNDLE_VERSION,
    name: preset.name,
    description: preset.description,
    designs,
  };
}
