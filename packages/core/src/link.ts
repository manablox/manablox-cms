/** A `link` field value: a document in this space or an external address, in one shape. */

export type LinkTarget = '_self' | '_blank';

export type LinkMode = 'internal' | 'external';

export interface LinkValue {
  mode: LinkMode;
  /** The document this points at, when `mode` is `internal`. */
  contentId: string | null;
  /** The address, when `mode` is `external`. */
  url: string | null;
  target: LinkTarget;
  /** Overrides the document's title, or names the external address. */
  label: string | null;
}

/** A delivered link. `href` is `null` when the document is gone or unpublished. */
export interface ResolvedLink extends LinkValue {
  href: string | null;
  /** The referenced document, when one was asked for and found. */
  content?: unknown;
}

/** http(s), mailto, tel, root-relative or fragment; never `javascript:` or `data:`. */
export function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|\/|#)/i.test(href.trim());
}

/** Prefixes `https://` when the address has no scheme. */
export function normalizeExternalUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('#')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}
