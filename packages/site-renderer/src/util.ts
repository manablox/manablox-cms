export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Text for `locale` from a `LocalizedText`, falling back to the default locale, then any. */
export function localize(value: unknown, locale: string, fallback: string): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  const pick = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : '');
  const direct = pick(locale) || pick(locale.split(/[-_]/)[0] as string) || pick(fallback);
  if (direct) return direct;
  for (const entry of Object.values(value)) if (typeof entry === 'string' && entry) return entry;
  return '';
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** http(s), mailto, tel, root-relative or fragment addresses only. */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (!href || href.startsWith('//')) return null;
  return /^(https?:|mailto:|tel:|\/|#)/i.test(href) ? href : null;
}

/** The path of an absolute or root-relative URL, without a trailing slash. */
export function pathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const path = new URL(url, 'http://x').pathname;
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  } catch {
    return null;
  }
}

/** A short, deterministic hash for ids. */
export function smallHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
