import { verifyPassword } from '@manablox/auth';
import type { Controls } from '@manablox/core';
import { clientIp, rateLimitHeaders } from '@manablox/server';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { signSiteAccess, verifySiteAccess } from '../access.js';
import { websiteKeys } from '../keys.js';
import type { SiteContext, SiteLookup } from '../services/site/context.js';
import { safePath, sameOrigin } from './site-forms.js';
import { sitePagePolicy } from './site-headers.js';

/** The cookie a correct site password sets; bound to the space and its password hash. */
const SITE_ACCESS_COOKIE = 'mb_site_access';
const ACCESS_SECONDS = 30 * 24 * 60 * 60;
const PASSWORD_PATH = '/_manablox/password';
const NO_STORE = 'private, no-store';
const NOINDEX = 'noindex, nofollow';

const MESSAGES = {
  wrong: 'That password is not right. Please try again.',
  rateLimited: 'Too many attempts. Please try again later.',
  failed: 'Something went wrong. Please try again.',
} as const;

/** Whether the request may see the site: it has no password, or carries a valid cookie. */
export function siteAdmitted(c: Context, secret: string, context: SiteContext): boolean {
  const passwordHash = context.settings.password;
  if (passwordHash === null) return true;
  const token = getCookie(c, SITE_ACCESS_COOKIE);
  return (
    token !== undefined &&
    verifySiteAccess(secret, token, { spaceId: context.space.id, passwordHash })
  );
}

/** The neutral password form; `next` is where a correct password leads. */
export function sitePasswordPage(
  c: Context,
  next: string,
  options: { status?: 401 | 403 | 429; message?: string; headers?: Record<string, string> } = {},
): Response {
  const escapeText = (value: string) =>
    value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
  const message = options.message
    ? `<p class="error" role="alert">${escapeText(options.message)}</p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Password required</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f4;color:#1b1b1b;font:16px/1.5 system-ui,sans-serif}main{width:100%;max-width:22rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #e3e3df;border-radius:12px}h1{margin:0 0 .25rem;font-size:1.25rem}p{margin:0 0 1rem;color:#555}label{display:block;margin-bottom:.25rem;font-weight:600;font-size:.875rem}input{box-sizing:border-box;width:100%;padding:.6rem .75rem;border:1px solid #c9c9c4;border-radius:8px;font:inherit}button{margin-top:1rem;width:100%;padding:.6rem;border:0;border-radius:8px;background:#1b1b1b;color:#fff;font:inherit;font-weight:600;cursor:pointer}.error{color:#b42318}</style></head><body><main><h1>Password required</h1><p>Enter the password to view this site.</p>${message}<form method="post" action="${PASSWORD_PATH}"><input type="hidden" name="next" value="${escapeText(next)}"><label for="mb-password">Password</label><input id="mb-password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Continue</button></form></main></body></html>`;
  return c.html(html, options.status ?? 401, {
    'content-security-policy': sitePagePolicy(false),
    'cache-control': NO_STORE,
    'x-robots-tag': NOINDEX,
    ...options.headers,
  });
}

export interface SitePasswordOptions {
  lookup: (c: Context) => Promise<SiteLookup>;
  protocolOf: (c: Context) => string;
  secret: string;
  /** Counts `site.password`. */
  controls: () => Controls;
  notFound: (c: Context) => Response;
}

/**
 * `POST /_manablox/password`: checks the site password and sets the access cookie, then
 * redirects (303) to `next`. Attempts count against `site.password` per client and space.
 */
export function mountSitePassword(app: Hono, options: SitePasswordOptions): void {
  const limitBody = bodyLimit({
    maxSize: 4096,
    onError: (c) => sitePasswordPage(c, '/', { status: 403, message: MESSAGES.failed }),
  });

  app.post(PASSWORD_PATH, limitBody, async (c) => {
    const found = await options.lookup(c);
    if (found.kind !== 'site') return options.notFound(c);
    const { context } = found;
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    const params =
      type === 'application/x-www-form-urlencoded'
        ? new URLSearchParams(await c.req.text())
        : new URLSearchParams();
    const next = safePath(params.get('next'));
    const back = () =>
      new Response(null, { status: 303, headers: { location: next, 'cache-control': NO_STORE } });
    const passwordHash = context.settings.password;
    if (passwordHash === null) return back();
    if (!sameOrigin(c)) return sitePasswordPage(c, next, { status: 403, message: MESSAGES.failed });

    const decision = await options
      .controls()
      .rate(context.space.id, [
        { rule: websiteKeys.rateLimits.password, key: `${context.space.id}:${clientIp(c)}` },
      ]);
    if (decision && !decision.allowed) {
      return sitePasswordPage(c, next, {
        status: 429,
        message: MESSAGES.rateLimited,
        headers: rateLimitHeaders(decision),
      });
    }

    const password = params.get('password') ?? '';
    const valid =
      password !== '' && (await verifyPassword(passwordHash, password).catch(() => false));
    if (!valid) return sitePasswordPage(c, next, { message: MESSAGES.wrong });

    const expiresAt = new Date(Date.now() + ACCESS_SECONDS * 1000);
    setCookie(
      c,
      SITE_ACCESS_COOKIE,
      signSiteAccess(options.secret, { spaceId: context.space.id, passwordHash }, expiresAt),
      {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        secure: options.protocolOf(c) === 'https:',
        maxAge: ACCESS_SECONDS,
      },
    );
    c.header('cache-control', NO_STORE);
    return c.redirect(next, 303);
  });
}
