import type { FontFamily, FontRole, ThemeFonts } from '@manablox/site';

type GoogleCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

/** Popular Google Fonts families, offered as suggestions; any other name works too. */
export const GOOGLE_FONTS: ReadonlyArray<{ family: string; category: GoogleCategory }> = [
  { family: 'Roboto', category: 'sans-serif' },
  { family: 'Open Sans', category: 'sans-serif' },
  { family: 'Lato', category: 'sans-serif' },
  { family: 'Montserrat', category: 'sans-serif' },
  { family: 'Poppins', category: 'sans-serif' },
  { family: 'Nunito', category: 'sans-serif' },
  { family: 'Work Sans', category: 'sans-serif' },
  { family: 'DM Sans', category: 'sans-serif' },
  { family: 'Manrope', category: 'sans-serif' },
  { family: 'IBM Plex Sans', category: 'sans-serif' },
  { family: 'Raleway', category: 'sans-serif' },
  { family: 'Rubik', category: 'sans-serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Crimson Pro', category: 'serif' },
  { family: 'Fraunces', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Oswald', category: 'sans-serif' },
  { family: 'Archivo Black', category: 'sans-serif' },
  { family: 'Caveat', category: 'handwriting' },
  { family: 'Fira Code', category: 'monospace' },
  { family: 'IBM Plex Mono', category: 'monospace' },
  { family: 'Source Code Pro', category: 'monospace' },
];

const FALLBACKS: Record<GoogleCategory, string> = {
  'sans-serif': 'system-ui, sans-serif',
  serif: 'Georgia, serif',
  display: 'system-ui, sans-serif',
  handwriting: 'cursive',
  monospace: 'ui-monospace, monospace',
};

export function googleFallback(category: GoogleCategory | undefined): string {
  return FALLBACKS[category ?? 'sans-serif'];
}

export const SOURCE_LABELS: Record<FontFamily['source'], string> = {
  bundled: 'built in',
  asset: 'uploaded',
  google: 'Google',
};

export const FONT_ROLES: ReadonlyArray<{ role: FontRole; label: string; hint: string }> = [
  { role: 'body', label: 'Body', hint: 'Running text, buttons and forms' },
  { role: 'heading', label: 'Headings', hint: 'h1 to h6' },
  { role: 'mono', label: 'Monospace', hint: 'Code' },
];

/** Adds a family, replacing one with the same id. */
export function withFamily(fonts: ThemeFonts, family: FontFamily): ThemeFonts {
  const exists = fonts.families.some((entry) => entry.id === family.id);
  return {
    ...fonts,
    families: exists
      ? fonts.families.map((entry) => (entry.id === family.id ? family : entry))
      : [...fonts.families, family],
  };
}

/** Removes a family unless a role uses it. */
export function withoutFamily(fonts: ThemeFonts, id: string): ThemeFonts {
  if (Object.values(fonts.roles).includes(id)) return fonts;
  return { ...fonts, families: fonts.families.filter((entry) => entry.id !== id) };
}

/** A family name from an uploaded file: `Acme-BoldItalic.woff2` -> `Acme`. */
export function familyFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').split(/[-_]/)[0] ?? 'Custom';
  return base.replace(/[^a-zA-Z0-9 ]+/g, ' ').trim() || 'Custom';
}

const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra-?light|ultra-?light/i, 200],
  [/light/i, 300],
  [/medium/i, 500],
  [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800],
  [/black|heavy/i, 900],
  [/bold/i, 700],
];

/** The weight and style a file name suggests; `400` and `normal` otherwise. */
export function styleFromFilename(filename: string): {
  weight: number;
  style: 'normal' | 'italic';
} {
  const name = filename.replace(/\.[^.]+$/, '');
  const weight = WEIGHT_WORDS.find(([pattern]) => pattern.test(name))?.[1] ?? 400;
  return { weight, style: /italic|oblique/i.test(name) ? 'italic' : 'normal' };
}
