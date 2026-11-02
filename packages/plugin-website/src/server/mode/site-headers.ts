/** Origins the `embed` element frames. */
const EMBED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://player.vimeo.com',
  'https://www.google.com',
  'https://open.spotify.com',
  'https://w.soundcloud.com',
];

/** Whether the site runs editor-supplied code, which needs a relaxed policy. */
export function hasSiteCode(site: {
  headCode?: string | undefined;
  bodyEndCode?: string | undefined;
}): boolean {
  return Boolean(site.headCode?.trim() || site.bodyEndCode?.trim());
}

/**
 * The CSP of a site page. Strict by default: scripts and fonts from the site only, styles
 * from the site plus `style` attributes (grid placement). Head or body code may load
 * anything, so with code only framing and plugins stay closed.
 */
export function sitePagePolicy(relaxed: boolean): string {
  if (relaxed) {
    return [
      "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Assets may live in a storage bucket.
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    `frame-src ${EMBED_ORIGINS.join(' ')}`,
    "connect-src 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * The canvas is framed by the admin and fed over `postMessage`; the admin injects draft CSS,
 * and assets come from the management API's origin.
 */
export function canvasPolicy(editorOrigins: readonly string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data: https: http:",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' https: http:",
    `frame-src ${EMBED_ORIGINS.join(' ')}`,
    "connect-src 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${editorOrigins.length > 0 ? editorOrigins.join(' ') : "'none'"}`,
  ].join('; ');
}

/**
 * The website mode's changes to the plugin mode baseline; pages set their CSP and
 * `x-frame-options` themselves, since the canvas is framed.
 */
export const WEBSITE_HEADERS: Readonly<Record<string, string | null>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  // `same-origin` would block a font or image another site of this instance links.
  'cross-origin-resource-policy': 'cross-origin',
  'origin-agent-cluster': null,
  'strict-transport-security': null,
  'x-dns-prefetch-control': null,
  'x-download-options': null,
  'x-frame-options': null,
  'x-permitted-cross-domain-policies': null,
  'x-xss-protection': null,
};

/** Origins from `site.editorOrigin`, normalised; invalid entries are dropped. */
export function editorOrigins(config: string | string[] | undefined): string[] {
  const list = Array.isArray(config) ? config : config ? [config] : [];
  return list.filter((entry) => URL.canParse(entry)).map((entry) => new URL(entry).origin);
}
