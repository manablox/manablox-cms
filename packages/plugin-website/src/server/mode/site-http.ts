import type { Context } from 'hono';
import { sitePagePolicy } from './site-headers.js';
import type { SiteRendererFile } from './site-renderer.js';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const NO_STORE = 'private, no-store';

/** The request's host name, from `Host`. */
export function hostOf(c: Context): string {
  return c.req.header('host') ?? new URL(c.req.url).host;
}

/** `https:` behind a TLS-terminating proxy, else the request's own scheme. */
export function protocolOf(c: Context): string {
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded === 'https' || forwarded === 'http') return `${forwarded}:`;
  return new URL(c.req.url).protocol;
}

/** A page that names nothing: for unknown hosts, hidden sites and failures. */
export function neutral(c: Context, status: 404 | 429 | 500 | 503): Response {
  const title =
    status === 404
      ? 'Not found'
      : status === 429
        ? 'Too many requests'
        : status === 503
          ? 'Temporarily unavailable'
          : 'Unavailable';
  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head><body><h1>${title}</h1></body></html>`,
    status,
    {
      'content-security-policy': sitePagePolicy(false),
      'cache-control': status === 404 ? 'public, max-age=0, s-maxage=60' : NO_STORE,
    },
  );
}

/** A content-hashed bundle, cached for good. */
export function sendFile(c: Context, file: SiteRendererFile | null): Response {
  if (!file) return neutral(c, 404);
  const body = typeof file.body === 'string' ? file.body : new Uint8Array(file.body);
  return c.body(body, 200, { 'content-type': file.contentType, 'cache-control': IMMUTABLE });
}
