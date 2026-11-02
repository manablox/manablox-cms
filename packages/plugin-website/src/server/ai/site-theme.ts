import {
  BUNDLED_FONTS,
  COLOR_ROLES,
  type ColorRole,
  type FontFamily,
  type FontRole,
  headingDefaults,
  type ThemeDesign,
  typeScale,
  validateSiteDesign,
} from '@manablox/site';

/**
 * Site theme design: tokens of a designed site from a brand color or a description. The
 * model picks colors, fonts and a few scales; the theme is built on the current one, so
 * element styles keep working, and checked with the site validators.
 */

export interface SiteThemeDesignContext {
  /** The theme the answer is built on; its element styles and spacing are kept. */
  base: ThemeDesign;
  /** A hex color the palette should be built around. */
  brandColor?: string | null | undefined;
}

export interface SiteThemeDesign {
  /** `null` when no answer made a valid theme. */
  theme: ThemeDesign | null;
  name: string;
  notes: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const PALETTE_NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,39}$/;
const MAX_PALETTE = 24;
/** WCAG AA for body text. */
const MIN_CONTRAST = 4.5;

const RADIUS: Record<string, Record<string, string>> = {
  none: { none: '0px', sm: '0px', md: '0px', lg: '0px', full: '9999px' },
  small: { none: '0px', sm: '0.125rem', md: '0.25rem', lg: '0.5rem', full: '9999px' },
  medium: { none: '0px', sm: '0.25rem', md: '0.5rem', lg: '0.75rem', full: '9999px' },
  large: { none: '0px', sm: '0.5rem', md: '1rem', lg: '1.5rem', full: '9999px' },
};

const SHADOW: Record<string, Record<string, string>> = {
  none: { sm: 'none', md: 'none', lg: 'none' },
  soft: {
    sm: '0 1px 2px rgb(0 0 0 / 0.05)',
    md: '0 4px 12px rgb(0 0 0 / 0.07)',
    lg: '0 12px 32px rgb(0 0 0 / 0.1)',
  },
  strong: {
    sm: '0 1px 3px rgb(0 0 0 / 0.12)',
    md: '0 6px 16px rgb(0 0 0 / 0.16)',
    lg: '0 16px 40px rgb(0 0 0 / 0.22)',
  },
};

const ROLE_HINTS: Record<ColorRole, string> = {
  bg: 'page background',
  surface: 'cards and bands set off from the background',
  text: 'body text on bg and surface',
  muted: 'secondary text, captions',
  primary: 'buttons, links and highlights',
  onPrimary: 'text on primary',
  border: 'lines and input borders',
  accent: 'a second highlight, used sparingly',
};

export const SITE_THEME_DESIGN_SYSTEM = [
  'You design visual themes for websites built with Manablox: color palettes, fonts and a few scales that a site-wide design system is generated from.',
  'You answer with one JSON object and nothing else: no markdown fence, no commentary.',
].join(' ');

/** The instruction for a theme design. */
export function composeSiteThemeDesignPrompt(
  request: string,
  context: SiteThemeDesignContext,
): string {
  const fonts = BUNDLED_FONTS.map((font) => `"${font.id}" (${font.name}, ${category(font)})`);
  return [
    'Design a website theme. Colors are named palette entries plus semantic roles that every element uses, so the roles decide how the site looks.',
    context.brandColor
      ? `Build the palette around the brand color ${context.brandColor}: use it, or a shade of it with enough contrast, as "primary".`
      : '',
    [
      'Rules:',
      '- "palette" names 6 to 16 colors as 6-digit hex values, like {"brand": "#1d4ed8", "ink": "#111827"}. Names are letters and digits, starting with a letter.',
      `- "roles" gives every role a palette name or a hex value: ${COLOR_ROLES.map((role) => `"${role}" (${ROLE_HINTS[role]})`).join(', ')}.`,
      `- "text" on "bg", "text" on "surface" and "onPrimary" on "primary" need a contrast ratio of at least ${MIN_CONTRAST}:1.`,
      '- "dark" is optional: the same roles for visitors who prefer a dark scheme, with the same contrast rules. Leave it out when the request does not ask for one.',
      `- "fonts" picks a font per role from these bundled fonts: ${fonts.join(', ')}. {"heading": "<id>", "body": "<id>"}.`,
      '- "scale" is the ratio between type sizes, from 1.125 (quiet) to 1.5 (dramatic); "headingWeight" is 500 to 900.',
      '- "radius" is "none", "small", "medium" or "large"; "shadow" is "none", "soft" or "strong".',
    ].join('\n'),
    'Answer with a single JSON object: {"name": "<a short theme name>", "palette": {...}, "roles": {...}, "dark": {...}, "fonts": {"heading": "...", "body": "..."}, "scale": 1.25, "headingWeight": 700, "radius": "medium", "shadow": "soft", "notes": "<one or two sentences on the choices>"}.',
    `The request: ${request.trim() || 'A clean, friendly theme.'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Builds and checks a theme from an answer; problems are sent back on retry. */
export async function readSiteThemeDesign(
  answer: Record<string, unknown>,
  context: SiteThemeDesignContext,
): Promise<{ value: SiteThemeDesign; problems: string[] }> {
  const problems: string[] = [];
  const theme = structuredClone(context.base);
  const palette = readPalette(answer.palette, context.base, problems);
  theme.colors = readColors(answer, palette, context.base, problems);
  readFonts(answer.fonts, theme, problems);
  readScales(answer, theme, problems);

  const result = validateSiteDesign('theme', theme);
  if (!result.ok) {
    for (const issue of result.issues.slice(0, 20))
      problems.push(`The theme is invalid at "${issue.path}": ${issue.message}.`);
  }

  return {
    value: {
      theme: result.ok ? result.value : null,
      name: typeof answer.name === 'string' ? answer.name.trim().slice(0, 100) : '',
      notes: typeof answer.notes === 'string' ? answer.notes.trim().slice(0, 1000) : '',
    },
    problems,
  };
}

/** The answer's palette, plus the base palette entries the base element styles name. */
function readPalette(
  value: unknown,
  base: ThemeDesign,
  problems: string[],
): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const [name, color] of Object.entries(asRecord(value))) {
    if (!PALETTE_NAME.test(name)) problems.push(`The palette name "${name}" is not allowed.`);
    else if (typeof color !== 'string' || !HEX.test(color))
      problems.push(`The palette color "${name}" must be a 6-digit hex value.`);
    else if (Object.keys(palette).length < MAX_PALETTE) palette[name] = color.toLowerCase();
  }
  if (Object.keys(palette).length === 0) problems.push('"palette" must name at least one color.');
  // Element styles of the base theme may name palette entries directly.
  for (const [, name] of JSON.stringify(base.elements).matchAll(/"color:([a-zA-Z0-9-]+)/g)) {
    const kept = base.colors.palette[name as string];
    if (name && kept && !palette[name] && !(COLOR_ROLES as readonly string[]).includes(name))
      palette[name] = kept;
  }
  return palette;
}

/** Roles and the optional dark scheme over the base roles, with their contrast checked. */
function readColors(
  answer: Record<string, unknown>,
  palette: Record<string, string>,
  base: ThemeDesign,
  problems: string[],
): ThemeDesign['colors'] {
  const roles = readRoles(answer.roles, 'roles', true, palette, problems);
  const dark =
    answer.dark === undefined ? null : readRoles(answer.dark, 'dark', false, palette, problems);
  const colors: ThemeDesign['colors'] = {
    palette,
    roles: { ...base.colors.roles, ...roles },
    ...(dark && Object.keys(dark).length ? { dark } : {}),
  };
  // Base roles may name palette entries the new palette lacks.
  for (const role of COLOR_ROLES) {
    const value = colors.roles[role];
    if (!palette[value] && !HEX.test(value)) colors.roles[role] = '#000000';
  }
  checkContrast(colors.roles, 'roles', palette, problems);
  if (colors.dark) checkContrast({ ...colors.roles, ...colors.dark }, 'dark', palette, problems);
  return colors;
}

function readRoles(
  value: unknown,
  where: string,
  required: boolean,
  palette: Record<string, string>,
  problems: string[],
): Partial<Record<ColorRole, string>> {
  const out: Partial<Record<ColorRole, string>> = {};
  const record = asRecord(value);
  for (const role of COLOR_ROLES) {
    const entry = record[role];
    if (entry === undefined) {
      if (required) problems.push(`"${where}.${role}" is missing.`);
      continue;
    }
    if (typeof entry === 'string' && (palette[entry] || HEX.test(entry))) out[role] = entry;
    else problems.push(`"${where}.${role}" must be a palette name or a 6-digit hex value.`);
  }
  for (const key of Object.keys(record)) {
    if (!(COLOR_ROLES as readonly string[]).includes(key))
      problems.push(`"${where}.${key}" is not a color role.`);
  }
  return out;
}

function checkContrast(
  scheme: Partial<Record<ColorRole, string>>,
  where: string,
  palette: Record<string, string>,
  problems: string[],
): void {
  const hex = (value: string | undefined): string | null =>
    value === undefined ? null : HEX.test(value) ? value : (palette[value] ?? null);
  const pairs: Array<[ColorRole, ColorRole]> = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['onPrimary', 'primary'],
  ];
  for (const [front, back] of pairs) {
    const a = hex(scheme[front]);
    const b = hex(scheme[back]);
    if (!a || !b) continue;
    const ratio = contrast(a, b);
    if (ratio < MIN_CONTRAST)
      problems.push(
        `${where}: "${front}" on "${back}" has a contrast of ${ratio.toFixed(2)}:1, below ${MIN_CONTRAST}:1.`,
      );
  }
}

/** Heading and body fonts from the bundled ones; families no role uses are dropped. */
function readFonts(value: unknown, theme: ThemeDesign, problems: string[]): void {
  const fonts = asRecord(value);
  const families = new Map<string, FontFamily>(
    theme.fonts.families.map((family) => [family.id, family]),
  );
  for (const role of ['heading', 'body'] as const satisfies FontRole[]) {
    const id = fonts[role];
    if (id === undefined) continue;
    const font = BUNDLED_FONTS.find((entry) => entry.id === id);
    if (!font) {
      problems.push(`"fonts.${role}" must be one of ${BUNDLED_FONTS.map((f) => f.id).join(', ')}.`);
      continue;
    }
    families.set(font.id, structuredClone(font));
    theme.fonts.roles[role] = font.id;
  }
  const used = new Set(Object.values(theme.fonts.roles));
  theme.fonts.families = [...families.values()].filter((family) => used.has(family.id));
}

/** Type scale and heading weight, radius and shadow. */
function readScales(answer: Record<string, unknown>, theme: ThemeDesign, problems: string[]): void {
  const scale = typeof answer.scale === 'number' ? answer.scale : null;
  const weight = typeof answer.headingWeight === 'number' ? answer.headingWeight : null;
  if (scale !== null || weight !== null) {
    if (scale !== null && !(scale >= 1.1 && scale <= 1.6))
      problems.push('"scale" must be from 1.125 to 1.5.');
    if (weight !== null && !(Number.isInteger(weight / 100) && weight >= 500 && weight <= 900))
      problems.push('"headingWeight" must be 500, 600, 700, 800 or 900.');
    const ratio = scale !== null && scale >= 1.1 && scale <= 1.6 ? scale : 1.25;
    const heading =
      weight !== null && Number.isInteger(weight / 100) && weight >= 500 && weight <= 900
        ? weight
        : 700;
    theme.type = typeScale(ratio, heading);
    theme.headings = headingDefaults();
  }

  if (answer.radius !== undefined) {
    const radius = RADIUS[String(answer.radius)];
    if (radius) theme.radius = { ...theme.radius, ...radius };
    else problems.push('"radius" must be none, small, medium or large.');
  }
  if (answer.shadow !== undefined) {
    const shadow = SHADOW[String(answer.shadow)];
    if (shadow) theme.shadow = { ...theme.shadow, ...shadow };
    else problems.push('"shadow" must be none, soft or strong.');
  }
}

function category(font: FontFamily): string {
  if (font.fallback.includes('monospace')) return 'monospace';
  if (font.fallback.includes('serif') && !font.fallback.includes('sans-serif')) return 'serif';
  return 'sans-serif';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** WCAG contrast ratio of two 6-digit hex colors. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
