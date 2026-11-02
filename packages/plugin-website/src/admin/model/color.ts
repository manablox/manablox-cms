import { COLOR_ROLES, type ColorRole, type ThemeColors } from '@manablox/site';

/** An sRGB color, channels 0 to 1. */
interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A channel of `rgb()`: a number 0-255 or a percentage. */
const channel = (raw: string) =>
  raw.endsWith('%') ? clamp(Number.parseFloat(raw) / 100) : clamp(Number.parseFloat(raw) / 255);

const alphaOf = (raw: string | undefined) =>
  raw === undefined
    ? 1
    : raw.endsWith('%')
      ? clamp(Number.parseFloat(raw) / 100)
      : clamp(Number.parseFloat(raw));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Parses hex, `rgb()` and `hsl()` colors; `null` for anything else (named, oklch, ...). */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  if (text === 'white') return { r: 1, g: 1, b: 1, a: 1 };
  if (text === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) : 1 };
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (!fn) return null;
  const parts = (fn[2] ?? '').split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [p0 = '', p1 = '', p2 = '', p3] = parts;
  if (fn[1]?.startsWith('rgb')) {
    const rgb = { r: channel(p0), g: channel(p1), b: channel(p2), a: alphaOf(p3) };
    return [rgb.r, rgb.g, rgb.b, rgb.a].some(Number.isNaN) ? null : rgb;
  }
  const hue = ((Number.parseFloat(p0) % 360) + 360) % 360;
  const [r, g, b] = hslToRgb(
    hue,
    clamp(Number.parseFloat(p1) / 100),
    clamp(Number.parseFloat(p2) / 100),
  );
  const rgb = { r, g, b, a: alphaOf(p3) };
  return [rgb.r, rgb.g, rgb.b, rgb.a].some(Number.isNaN) ? null : rgb;
}

/** `#rrggbb` of a color, for the native color input; `null` when it cannot be read. */
export function toHex(value: string): string | null {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const byte = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

function luminance({ r, g, b }: Rgb): number {
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Composites a translucent color over an opaque one. */
function over(top: Rgb, bottom: Rgb): Rgb {
  const mix = (a: number, b: number) => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** WCAG contrast ratio of text on a background, 1 to 21; `null` when either is unreadable. */
export function contrastRatio(text: string, background: string): number | null {
  const fg = parseColor(text);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const base = bg.a < 1 ? over(bg, { r: 1, g: 1, b: 1, a: 1 }) : bg;
  const top = fg.a < 1 ? over(fg, base) : fg;
  const [light, dark] = [luminance(top), luminance(base)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** A role's or palette entry's CSS color; roles may name a palette entry. */
export function resolveColor(
  colors: ThemeColors,
  value: string | undefined,
  scheme: 'light' | 'dark' = 'light',
): string | null {
  if (!value) return null;
  if ((COLOR_ROLES as readonly string[]).includes(value)) {
    const role = value as ColorRole;
    const raw = (scheme === 'dark' ? colors.dark?.[role] : undefined) ?? colors.roles[role];
    return raw ? (colors.palette[raw] ?? raw) : null;
  }
  return colors.palette[value] ?? value;
}

interface ContrastPair {
  text: ColorRole;
  background: ColorRole;
  label: string;
  /** Needed level: `aa` for body text, `large` for UI and large text. */
  needs: 'aa' | 'large';
}

/** Text and background roles that appear together on every site. */
const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { text: 'text', background: 'bg', label: 'Text on background', needs: 'aa' },
  { text: 'text', background: 'surface', label: 'Text on surface', needs: 'aa' },
  { text: 'muted', background: 'bg', label: 'Muted text on background', needs: 'aa' },
  { text: 'primary', background: 'bg', label: 'Links on background', needs: 'aa' },
  { text: 'onPrimary', background: 'primary', label: 'Button text on primary', needs: 'aa' },
  { text: 'border', background: 'bg', label: 'Borders on background', needs: 'large' },
];

export interface ContrastCheck extends ContrastPair {
  ratio: number | null;
  ok: boolean | null;
}

/** Each pair's ratio in one scheme; `ok` is `null` when a color cannot be read. */
export function checkContrast(
  colors: ThemeColors,
  scheme: 'light' | 'dark' = 'light',
): ContrastCheck[] {
  return CONTRAST_PAIRS.map((pair) => {
    const text = resolveColor(colors, pair.text, scheme);
    const background = resolveColor(colors, pair.background, scheme);
    const ratio = text && background ? contrastRatio(text, background) : null;
    const min = pair.needs === 'aa' ? 4.5 : 3;
    return { ...pair, ratio, ok: ratio === null ? null : ratio >= min };
  });
}
