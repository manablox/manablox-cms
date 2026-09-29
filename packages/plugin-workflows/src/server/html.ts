/** Minimal regex-based HTML handling: title, readable text and links. */

const DROP_BLOCKS = /<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi;
const BLOCK_END = /<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre)>/gi;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/** HTML as plain text, blocks separated by blank lines. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(DROP_BLOCKS, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK_END, '\n\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? decodeEntities(match[1]).trim().slice(0, 300) : '';
}

/** The `content` of a named meta tag, either attribute order. */
export function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']*)`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return '';
}

/** The page `body`, or the whole document. */
export function pageBody(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return match?.[1] ?? html;
}

/** Absolute http(s) links, deduplicated and without fragments. */
export function pageLinks(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    const href = decodeEntities(match[1] as string).trim();
    if (!href || href.startsWith('#')) continue;
    try {
      const url = new URL(href, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      url.hash = '';
      out.add(url.href);
    } catch {
      // Skip malformed hrefs.
    }
  }
  return [...out];
}

/** Text inside every element matching a class or id selector. */
export function extractBySelector(html: string, selector: string): string | null {
  const tag = /^[a-z][a-z0-9]*$/i.exec(selector.trim());
  if (tag) {
    const pattern = new RegExp(`<${tag[0]}\\b[^>]*>([\\s\\S]*?)</${tag[0]}>`, 'gi');
    const parts = [...html.matchAll(pattern)].map((match) => match[1] ?? '');
    return parts.length ? parts.join('\n') : null;
  }
  const attribute = /^([.#])([\w-]+)$/.exec(selector.trim());
  if (!attribute) return null;
  const [, sigil, value] = attribute as unknown as [string, string, string];
  const name = sigil === '.' ? 'class' : 'id';
  // The element ends at the next closing tag of its kind; fine for article/main wrappers.
  const open = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*${name}=["'][^"']*\\b${value}\\b[^"']*["'][^>]*>`,
    'i',
  );
  const match = open.exec(html);
  if (!match) return null;
  const rest = html.slice(match.index + match[0].length);
  const close = new RegExp(`</${match[1]}>`, 'i').exec(rest);
  return close ? rest.slice(0, close.index) : rest;
}
