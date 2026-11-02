import { stagingIdOf } from '@manablox/core';
import type { MediaScope } from '@manablox/server';
import type { Context, Hono } from 'hono';
import {
  type SiteSurfaceContext,
  siteAdmittedFor,
  siteLookup,
  siteShareOf,
} from './site-context.js';
import { IMMUTABLE, neutral, sendFile } from './site-http.js';

/** Fonts, client bundles and the design stylesheets under `/_site`. */
export function mountSiteAssets(app: Hono, ctx: SiteSurfaceContext): void {
  app.get('/_site/fonts/*', async (c) => {
    const path = c.req.path.slice('/_site/fonts/'.length);
    if (!/^(?!.*\.\.)[a-zA-Z0-9_-][a-zA-Z0-9._/-]{0,199}\.woff2$/.test(path)) {
      return neutral(c, 404);
    }
    const body = await ctx.renderer.font(path);
    if (!body) return neutral(c, 404);
    return c.body(new Uint8Array(body), 200, {
      'content-type': 'font/woff2',
      'cache-control': IMMUTABLE,
      'access-control-allow-origin': '*',
    });
  });

  app.get('/_site/islands/:file', async (c) =>
    sendFile(c, await ctx.renderer.clientFile(`islands/${c.req.param('file')}`)),
  );

  app.get('/_site/:file', async (c) => {
    const file = c.req.param('file');
    if (file.endsWith('.js')) return sendFile(c, await ctx.renderer.clientFile(file));
    const match = /^([A-Za-z0-9_-]{8,64})\.css$/.exec(file);
    if (!match) return neutral(c, 404);
    const hash = match[1] as string;
    // Hashed, so one this process holds is served without looking the host up.
    const css =
      ctx.loader.keptStylesheet(hash) ??
      (await ctx.loader.stylesheet(hash, await siteContextOf(ctx, c)));
    if (css === null) return neutral(c, 404);
    return c.body(css, 200, {
      'content-type': 'text/css; charset=utf-8',
      'content-length': String(Buffer.byteLength(css)),
      'cache-control': IMMUTABLE,
    });
  });
}

async function siteContextOf(ctx: SiteSurfaceContext, c: Context) {
  const found = await siteLookup(ctx, c);
  return found.kind === 'site' ? found.context : null;
}

/** `/media` restricted to the request's site: its design assets, and more for a share link. */
export async function siteMediaScope(
  ctx: SiteSurfaceContext,
  c: Context,
): Promise<MediaScope | null> {
  const found = await siteLookup(ctx, c);
  if (found.kind !== 'site') return null;
  const spaceId = found.context.space.id;
  const share = await siteShareOf(ctx, c, found.context);
  const locked = found.context.settings.password !== null;
  if (locked && !(await siteAdmittedFor(ctx, c, found.context, share))) return null;
  return {
    spaceId,
    stagingId: stagingIdOf(found.context.scope),
    private: locked,
    allows: async (asset) => {
      if (await ctx.loader.designUsesAsset(spaceId, asset.id, found.context.scope)) return true;
      return share !== null ? 'private' : false;
    },
  };
}
