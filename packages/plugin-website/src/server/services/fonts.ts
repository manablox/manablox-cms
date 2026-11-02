import { ManabloxError } from '@manablox/core';
import type { FontFamily, FontFile } from '@manablox/site';

/** One weight and style of a Google Fonts family. */
export interface GoogleFontVariant {
  weight: number;
  style: 'normal' | 'italic';
}

export interface GoogleFontImportInput {
  /** The family as Google Fonts names it, e.g. `Playfair Display`. */
  family: string;
  variants: GoogleFontVariant[];
  /** Fallback stack; `system-ui, sans-serif` when absent. */
  fallback?: string | undefined;
}

export interface GoogleFontImportOptions {
  /** Stores one woff2 file as an asset of the space. */
  store: (file: { filename: string; body: Buffer }) => Promise<{ id: string }>;
  fetch?: typeof globalThis.fetch;
  /** Per request; 15 seconds when absent. */
  timeoutMs?: number;
}

const CSS_URL = 'https://fonts.googleapis.com/css2';
const FILE_HOST = 'fonts.gstatic.com';
/** Browsers this new get woff2 from the css2 API. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
export const GOOGLE_FONT_FAMILY = /^[a-zA-Z0-9][a-zA-Z0-9 ]{0,79}$/;
export const GOOGLE_FONT_MAX_VARIANTS = 18;
const FALLBACK = /^[a-zA-Z0-9 ,"'_-]{1,200}$/;
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const failure = (message: string, status: 'badRequest' | 'unavailable' = 'unavailable') =>
  ManabloxError[status]('plugins.website.design.invalid', { message });

/** `Playfair Display` -> `playfair-display`, a token name. */
export function googleFontId(family: string): string {
  const id =
    family
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34) || 'font';
  // Role names are not family ids.
  return ['body', 'heading', 'mono'].includes(id) ? `${id}-font` : id;
}

/** The css2 URL for a family and its variants, sorted as the API requires. */
export function googleFontCssUrl(family: string, variants: readonly GoogleFontVariant[]): string {
  const tuples = [
    ...new Set(variants.map((v) => `${v.style === 'italic' ? 1 : 0},${v.weight}`)),
  ].sort((a, b) => {
    const [ai = 0, aw = 0] = a.split(',').map(Number);
    const [bi = 0, bw = 0] = b.split(',').map(Number);
    return ai - bi || aw - bw;
  });
  const name = family.trim().replace(/ +/g, '+');
  return `${CSS_URL}?family=${name}:ital,wght@${tuples.join(';')}&display=swap`;
}

interface FaceRule {
  subset: string | null;
  style: 'normal' | 'italic';
  weight: string;
  url: string;
}

/** The `@font-face` rules of a css2 response, each with the subset comment above it. */
export function parseGoogleFontCss(css: string): FaceRule[] {
  const out: FaceRule[] = [];
  const pattern = /(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(pattern)) {
    const body = match[2] ?? '';
    const style = /font-style:\s*italic/.test(body) ? 'italic' : 'normal';
    const weight = /font-weight:\s*([0-9 ]+);/.exec(body)?.[1]?.trim();
    const url = /src:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/.exec(body)?.[1]?.trim();
    if (!weight || !url) continue;
    out.push({ subset: match[1] ?? null, style, weight, url: url.replace(/^['"]|['"]$/g, '') });
  }
  return out;
}

async function download(
  fetcher: typeof globalThis.fetch,
  url: string,
  limit: number,
  timeoutMs: number,
): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/css,*/*;q=0.1' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw failure('Google Fonts could not be reached from the server. Check its internet access.');
  }
  if (response.status === 400 || response.status === 404) {
    throw failure('Google Fonts does not offer that family in those styles.', 'badRequest');
  }
  if (!response.ok) throw failure(`Google Fonts answered with status ${response.status}.`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > limit) throw failure('A font file from Google Fonts was too large.');
  return body;
}

/**
 * Downloads a Google Fonts family's latin woff2 files and stores each as an asset, so the
 * site serves them itself. Returns the theme's family entry.
 */
export async function importGoogleFont(
  input: GoogleFontImportInput,
  options: GoogleFontImportOptions,
): Promise<FontFamily> {
  const family = input.family.trim();
  if (!GOOGLE_FONT_FAMILY.test(family)) {
    throw failure('Enter a font family name of letters, digits and spaces.', 'badRequest');
  }
  const variants = input.variants.filter(
    (v) => WEIGHTS.includes(v.weight) && (v.style === 'normal' || v.style === 'italic'),
  );
  if (variants.length === 0 || variants.length > GOOGLE_FONT_MAX_VARIANTS) {
    throw failure(`Pick between 1 and ${GOOGLE_FONT_MAX_VARIANTS} styles.`, 'badRequest');
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const css = (
    await download(fetcher, googleFontCssUrl(family, variants), MAX_CSS_BYTES, timeoutMs)
  ).toString('utf8');
  const faces = parseGoogleFontCss(css);
  // One file per style: the latin subset, or the only one when the response has no subsets.
  const picked = new Map<string, FaceRule>();
  for (const face of faces) {
    const key = `${face.style}:${face.weight}`;
    if (face.subset === 'latin' || (face.subset === null && !picked.has(key)))
      picked.set(key, face);
  }
  if (picked.size === 0) throw failure('Google Fonts sent no woff2 files for that family.');

  const stored = new Map<string, string>();
  const files: FontFile[] = [];
  const slug = googleFontId(family);
  for (const face of picked.values()) {
    let url: URL;
    try {
      url = new URL(face.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.hostname !== FILE_HOST) continue;
    let assetId = stored.get(url.href);
    if (!assetId) {
      const body = await download(fetcher, url.href, MAX_FILE_BYTES, timeoutMs);
      const weight = face.weight.replace(' ', '-');
      const filename = `${slug}-${weight}${face.style === 'italic' ? '-italic' : ''}.woff2`;
      assetId = (await options.store({ filename, body })).id;
      stored.set(url.href, assetId);
    }
    const weight = /^\d+$/.test(face.weight) ? Number(face.weight) : face.weight;
    files.push({ assetId, weight, style: face.style });
  }
  if (files.length === 0) throw failure('Google Fonts sent no usable font files.');

  return {
    id: slug,
    name: family,
    source: 'google',
    files,
    fallback: FALLBACK.test(input.fallback?.trim() ?? '')
      ? (input.fallback?.trim() as string)
      : 'system-ui, sans-serif',
  };
}
