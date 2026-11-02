import type { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { websiteKeys } from '../keys.js';
import { sharedWith } from '../services/site/context.js';
import { verifySiteShare } from '../share.js';
import {
  featureOn,
  SITE_SHARE_COOKIE,
  type SiteSurfaceContext,
  siteLookup,
} from './site-context.js';
import { canvasPolicy } from './site-headers.js';
import { NO_STORE, neutral, protocolOf } from './site-http.js';

/** A share cookie lasts at most this long, whatever the link's own expiry. */
const SHARE_COOKIE_MAX_SECONDS = 60 * 60;

/** `/_manablox/domain-check` for on-demand TLS, the design canvas and share links. */
export function mountSiteSystem(app: Hono, ctx: SiteSurfaceContext): void {
  app.get('/_manablox/domain-check', async (c) => {
    const domain = c.req.query('domain') ?? '';
    const known = domain !== '' && (await ctx.loader.knowsHost(domain));
    return c.text(known ? 'ok' : 'unknown', known ? 200 : 404, { 'cache-control': NO_STORE });
  });

  app.get('/_manablox/canvas', async (c) => {
    // Without a configured editor nothing may frame it, so there is nothing to serve.
    const referrer = c.req.header('referer');
    const from = referrer && URL.canParse(referrer) ? new URL(referrer).origin : null;
    const editor = ctx.origins.find((origin) => origin === from) ?? ctx.origins[0];
    if (!editor) return neutral(c, 404);
    return c.html(await ctx.renderer.canvasPage(editor), 200, {
      'content-security-policy': canvasPolicy(ctx.origins),
      'cache-control': 'no-cache',
    });
  });

  app.get('/_manablox/share/:token', async (c) => {
    const found = await siteLookup(ctx, c);
    if (found.kind !== 'site') return neutral(c, 404);
    const payload = sharedWith(
      verifySiteShare(ctx.secret, c.req.param('token')),
      found.context.scope,
    );
    if (!payload) return neutral(c, 404);
    if (!(await featureOn(ctx, payload.spaceId, websiteKeys.features.shareLinks)))
      return neutral(c, 404);
    const protocol = protocolOf(c);
    const seconds = Math.min(
      SHARE_COOKIE_MAX_SECONDS,
      Math.floor((payload.expiresAt.getTime() - Date.now()) / 1000),
    );
    setCookie(c, SITE_SHARE_COOKIE, c.req.param('token'), {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: protocol === 'https:',
      maxAge: Math.max(1, seconds),
    });
    const target = await ctx.loader.sharePath(found.context, payload.contentId, protocol);
    c.header('cache-control', NO_STORE);
    c.header('referrer-policy', 'no-referrer');
    return c.redirect(target, 302);
  });
}
