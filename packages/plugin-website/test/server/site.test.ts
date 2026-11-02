import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fnv1a } from '@manablox/core';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import { bootstrap, createApp, type Runtime } from '@manablox/server';
import { defaultSiteSettings, type SiteRenderInput } from '@manablox/site';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SiteRenderer, websiteMode, websitePlugin } from '../../src/index.js';
import { websiteOf } from '../helpers/runtime.js';

let db: TestDatabase;
let dir: string;
let runtime: Runtime;
let app: Hono;
const rendered: SiteRenderInput[] = [];

/** Echoes what it was given, so tests read the render input back out of the HTML. */
const renderer: SiteRenderer = {
  renderPage: async (input) => {
    rendered.push(input);
    const echo = {
      mode: input.mode,
      locale: input.locale,
      url: input.url,
      status: input.status,
      title: input.document?.title ?? null,
      fields: input.document?.fields ?? null,
      alternates: input.alternates,
      menus: input.menus,
      cssHref: input.cssHref,
    };
    return {
      html: `<!doctype html><title>${echo.title ?? 'Not found'}</title><!--${JSON.stringify(echo)}-->`,
      status: input.status,
    };
  },
  clientFile: async (path) =>
    path === 'islands/menu.abc123.js'
      ? { body: 'export {}', contentType: 'text/javascript' }
      : null,
  font: async (path) => (path === 'inter/Inter-Variable.woff2' ? new Uint8Array([1, 2, 3]) : null),
  canvasPage: async (editorOrigin) => `<!doctype html><div data-editor="${editorOrigin}"></div>`,
};

type Echo = {
  mode: string;
  locale: string;
  url: string;
  status: number;
  title: string | null;
  fields: Record<string, unknown> | null;
  alternates: Array<{ locale: string; url: string }>;
  menus: Record<string, { items: Array<{ label: string; url: string | null; current?: boolean }> }>;
  cssHref: string;
};

const echoOf = async (response: Response): Promise<Echo> => {
  const html = await response.text();
  const match = /<!--(.*)-->/s.exec(html);
  if (!match) throw new Error(`no echo in ${html}`);
  return JSON.parse(match[1] as string) as Echo;
};

const get = (url: string, headers: Record<string, string> = {}) =>
  app.request(new Request(url, { headers }));

let spaceId: string;
let typeId: string;
let about: { id: string; localizationId: string };

const createPage = async (
  space: string,
  input: { title: string; slug: string; locale?: string; localizationId?: string },
) =>
  runtime.content.create({
    spaceId: space,
    typeId,
    locale: input.locale ?? 'en',
    title: input.title,
    slug: input.slug,
    fields: { summary: `${input.title} summary` },
    ...(input.localizationId ? { localizationId: input.localizationId } : {}),
  });

const publishPage = async (space: string, input: Parameters<typeof createPage>[1]) => {
  const row = await createPage(space, input);
  return runtime.content.publish(space, row.id);
};

beforeAll(async () => {
  db = await createTestDatabase('server_site', { plugins: [websitePlugin()] });
  dir = await mkdtemp(join(tmpdir(), 'manablox-site-'));
  runtime = await bootstrap({
    database: { url: db.url },
    auth: { secret: 'site-test-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [{ name: 'page', fields: [{ name: 'summary', type: 'string' }] }],
    logLevel: 'silent',
    server: { mode: 'website', rateLimit: false },
    plugins: [websitePlugin({ editorOrigin: 'http://admin.test', renderer })],
    cache: { enabled: true, ttl: 300 },
    storage: { driver: 'local', local: { path: join(dir, 'files') } },
  });
  app = await createApp(runtime);
  typeId = runtime.manablox.contentTypes.getByName('page').id;

  const space = await runtime.repos.spaces.create({
    name: 'Designed',
    machineName: 'designed',
    url: 'http://unused.test',
    defaultLocale: 'en',
    locales: ['en', 'de'],
  });
  spaceId = space.id;
  await websiteOf(runtime).settings.set(spaceId, { mode: 'designed' });
  await websiteOf(runtime).domains.create(spaceId, { hostname: 'site.test' });
  await websiteOf(runtime).domains.create(spaceId, {
    hostname: 'www.site.test',
    redirectToPrimary: true,
  });

  const home = await publishPage(spaceId, { title: 'Home', slug: 'home' });
  await runtime.spaces.setHome(spaceId, home.id);
  about = await publishPage(spaceId, { title: 'About', slug: 'about' });
  await publishPage(spaceId, {
    title: 'Ueber uns',
    slug: 'ueber-uns',
    locale: 'de',
    localizationId: about.localizationId,
  });
  await createPage(spaceId, { title: 'Draft only', slug: 'draft-only' });

  const menu = await runtime.menus.create({ spaceId, name: 'Main', machineName: 'main' });
  await runtime.menus.setItems(spaceId, menu.id, [
    { localizationId: about.localizationId },
    { label: 'Elsewhere', url: 'https://example.com/' },
  ]);

  const external = await runtime.repos.spaces.create({
    name: 'External',
    machineName: 'external',
    url: 'http://unused.test',
  });
  await websiteOf(runtime).domains.create(external.id, { hostname: 'external.test' });
});

afterAll(async () => {
  await runtime?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('site hosts', () => {
  it('answers an unknown host with a neutral 404', async () => {
    const response = await get('http://nobody.test/about');
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain('Not found');
    expect(html).not.toContain('Designed');
  });

  it('hides a space with an external frontend', async () => {
    expect((await get('http://external.test/')).status).toBe(404);
  });

  it('moves a secondary host to the primary one', async () => {
    const response = await get('http://www.site.test/about?x=1');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('http://site.test/about?x=1');
  });

  it('ignores the port and case of the host', async () => {
    const response = await get('http://SITE.test:3200/about');
    expect(response.status).toBe(200);
    // Absolute links keep the port the request came in on.
    expect(await echoOf(response)).toMatchObject({
      title: 'About',
      url: 'http://site.test:3200/about',
    });
    const moved = await get('http://www.site.test:3200/about');
    expect(moved.headers.get('location')).toBe('http://site.test:3200/about');
  });

  it('keeps redirects on the site and ignores invalid ports', async () => {
    const encoded = await get('http://site.test/en/%5Cevil.test');
    expect(encoded.status).toBe(301);
    expect(encoded.headers.get('location')).toBe('/%5Cevil.test');
    const slashes = await get('http://site.test/en/%2F%2Fevil.test');
    expect(slashes.headers.get('location')).toBe('/%2F%2Fevil.test');
    const moved = await get('http://www.site.test/a%0d%0ab');
    expect(moved.headers.get('location')).toBe('http://site.test/a%0d%0ab');

    const valid = await get('http://site.test/about', { host: 'site.test:8080' });
    expect((await echoOf(valid)).url).toBe('http://site.test:8080/about');
    const odd = await get('http://site.test/about', { host: 'site.test:99999' });
    expect(odd.status).toBe(200);
    expect((await echoOf(odd)).url).toBe('http://site.test/about');
  });

  it('answers form posts with 503 without a forms config, other methods with a neutral 404', async () => {
    const post = await app.request(
      new Request('http://site.test/_manablox/forms/block/x/y', { method: 'POST', body: 'a=1' }),
    );
    expect(post.status).toBe(503);
    expect((await post.json()).ok).toBe(false);
    const put = await app.request(new Request('http://site.test/about', { method: 'PUT' }));
    expect(put.status).toBe(404);
    expect(put.headers.get('content-type')).toContain('text/html');
  });

  it('answers the domain check for known hosts only', async () => {
    expect((await get('http://any.test/_manablox/domain-check?domain=site.test')).status).toBe(200);
    expect((await get('http://any.test/_manablox/domain-check?domain=www.site.test')).status).toBe(
      200,
    );
    expect((await get('http://any.test/_manablox/domain-check?domain=nope.test')).status).toBe(404);
    expect((await get('http://any.test/_manablox/domain-check')).status).toBe(404);
  });
});

describe('kept host lookups', () => {
  it('serves a host as soon as its domain is added, and stops once it is removed', async () => {
    expect((await get('http://late.test/about')).status).toBe(404);
    const domain = await websiteOf(runtime).domains.create(spaceId, { hostname: 'late.test' });
    expect((await get('http://late.test/about')).status).toBe(200);
    await websiteOf(runtime).domains.delete(spaceId, domain.id);
    expect((await get('http://late.test/about')).status).toBe(404);
  });

  it('hides the site as soon as its mode changes, and shows it again', async () => {
    expect((await get('http://site.test/about')).status).toBe(200);
    await websiteOf(runtime).settings.set(spaceId, { mode: 'external' });
    try {
      expect((await get('http://site.test/about')).status).toBe(404);
    } finally {
      await websiteOf(runtime).settings.set(spaceId, { mode: 'designed' });
    }
    expect((await get('http://site.test/about')).status).toBe(200);
  });

  it('reads a space change at once', async () => {
    expect((await echoOf(await get('http://site.test/about'))).locale).toBe('en');
    await runtime.spaces.update(spaceId, { defaultLocale: 'de' });
    try {
      const response = await get('http://site.test/ueber-uns');
      expect(response.status).toBe(200);
      expect((await echoOf(response)).locale).toBe('de');
    } finally {
      await runtime.spaces.update(spaceId, { defaultLocale: 'en' });
    }
    expect((await echoOf(await get('http://site.test/about'))).locale).toBe('en');
  });
});

describe('site pages', () => {
  it('serves the home document at the root', async () => {
    const response = await get('http://site.test/');
    expect(response.status).toBe(200);
    const echo = await echoOf(response);
    expect(echo).toMatchObject({ title: 'Home', locale: 'en', url: 'http://site.test/' });
    expect(echo.fields).toEqual({ summary: 'Home summary' });
  });

  it('serves documents by permalink with alternates and resolved menus', async () => {
    const response = await get('http://site.test/about');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const echo = await echoOf(response);
    expect(echo).toMatchObject({ title: 'About', url: 'http://site.test/about', mode: 'live' });
    expect(echo.alternates).toEqual(
      expect.arrayContaining([
        { locale: 'en', url: 'http://site.test/about' },
        { locale: 'de', url: 'http://site.test/de/ueber-uns' },
      ]),
    );
    expect(echo.menus.main?.items).toEqual([
      expect.objectContaining({ label: 'About', url: '/about', current: true }),
      expect.objectContaining({ label: 'Elsewhere', url: 'https://example.com/' }),
    ]);
    expect(echo.cssHref).toMatch(/^\/_site\/[A-Za-z0-9_-]+\.css$/);
  });

  it('routes other locales under their prefix and the default one without', async () => {
    const german = await get('http://site.test/de/ueber-uns');
    expect(german.status).toBe(200);
    const echo = await echoOf(german);
    expect(echo).toMatchObject({ title: 'Ueber uns', locale: 'de' });
    expect(echo.menus.main?.items[0]).toMatchObject({ url: '/de/ueber-uns', current: true });

    const prefixed = await get('http://site.test/en/about');
    expect(prefixed.status).toBe(301);
    expect(prefixed.headers.get('location')).toBe('/about');
  });

  it('renders a generated not-found page, then the nominated one', async () => {
    const generated = await get('http://site.test/nothing-here');
    expect(generated.status).toBe(404);
    expect((await echoOf(generated)).title).toBeNull();

    const notFound = await publishPage(spaceId, { title: 'Lost', slug: 'lost' });
    await websiteOf(runtime).settings.set(spaceId, { notFoundContentId: notFound.id });
    const nominated = await get('http://site.test/nothing-here');
    expect(nominated.status).toBe(404);
    const echo = await echoOf(nominated);
    expect(echo).toMatchObject({ title: 'Lost', status: 404, alternates: [] });
  });

  it('sends security and cache headers and honours ETags', async () => {
    const response = await get('http://site.test/about');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    // The website mode drops the rest of the plugin mode baseline.
    expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(response.headers.get('origin-agent-cluster')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    // Twice: rendered, then from the page cache.
    for (const each of [response, await get('http://site.test/about')]) {
      const length = each.headers.get('content-length');
      expect(Number(length)).toBe((await each.clone().arrayBuffer()).byteLength);
    }
    const etag = response.headers.get('etag') as string;
    expect(etag).toMatch(/^W\//);
    const again = await get('http://site.test/about', { 'if-none-match': etag });
    expect(again.status).toBe(304);
  });

  it('serves the stylesheet, bundled fonts and islands as immutable files', async () => {
    const { cssHref } = await echoOf(await get('http://site.test/about'));
    const css = await get(`http://site.test${cssHref}`);
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toContain('text/css');
    expect(css.headers.get('cache-control')).toContain('immutable');
    expect(await css.text()).toContain('@layer');

    expect((await get('http://site.test/_site/AAAAAAAAAAAAAAAA.css')).status).toBe(404);
    const font = await get('http://site.test/_site/fonts/inter/Inter-Variable.woff2');
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');
    expect((await get('http://site.test/_site/fonts/../secret.woff2')).status).toBe(404);
    expect((await get('http://site.test/_site/islands/menu.abc123.js')).status).toBe(200);
    expect((await get('http://site.test/_site/islands/nope.js')).status).toBe(404);
  });
});

describe('site redirects', () => {
  it('follows a manual redirect after a permalink miss', async () => {
    await runtime.redirects.create(spaceId, { fromPath: '/old', toPath: '/about' });
    const response = await get('http://site.test/old');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/about');
  });

  it('redirects to a document by its current permalink in the locale', async () => {
    await runtime.redirects.create(spaceId, {
      fromPath: '/team',
      locale: 'de',
      toContentId: about.localizationId,
      status: 302,
    });
    const response = await get('http://site.test/de/team');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/de/ueber-uns');
  });

  it('answers an old permalink with a 301 once the document moved', async () => {
    const renamedSource = await publishPage(spaceId, { title: 'Moving', slug: 'moving' });
    expect((await get('http://site.test/moving')).status).toBe(200);
    await runtime.content.update(spaceId, renamedSource.id, {
      spaceId,
      typeId,
      locale: 'en',
      title: 'Moved',
      slug: 'moved',
      fields: { summary: 'Moved summary' },
    });
    await runtime.content.publish(spaceId, renamedSource.id);

    const old = await get('http://site.test/moving');
    expect(old.status).toBe(301);
    expect(old.headers.get('location')).toBe('/moved');
    expect((await echoOf(await get('http://site.test/moved'))).title).toBe('Moved');
  });
});

describe('site cache', () => {
  it('serves repeat requests from the cache until a publish purges them', async () => {
    const page = await publishPage(spaceId, { title: 'Cached', slug: 'cached' });
    await get('http://site.test/cached');
    const before = rendered.length;
    await get('http://site.test/cached');
    expect(rendered.length).toBe(before);

    await runtime.content.update(spaceId, page.id, {
      spaceId,
      typeId,
      locale: 'en',
      title: 'Cached again',
      slug: 'cached',
      fields: { summary: 'new' },
    });
    // A draft change is not live yet.
    expect((await echoOf(await get('http://site.test/cached'))).title).toBe('Cached');
    await runtime.content.publish(spaceId, page.id);
    expect((await echoOf(await get('http://site.test/cached'))).title).toBe('Cached again');
  });

  it('keeps pages apart whose permalinks collide under a 32-bit hash', async () => {
    // Both permalinks hash to 27d5c761 under fnv1a.
    expect(fnv1a('slug-11unw')).toBe(fnv1a('slug-1ywba'));
    await publishPage(spaceId, { title: 'First', slug: 'slug-11unw' });
    await publishPage(spaceId, { title: 'Second', slug: 'slug-1ywba' });
    expect((await echoOf(await get('http://site.test/slug-11unw'))).title).toBe('First');
    expect((await echoOf(await get('http://site.test/slug-1ywba'))).title).toBe('Second');
  });

  it('renders again with the new stylesheet after a design publish', async () => {
    const first = await echoOf(await get('http://site.test/about'));
    const settings = { ...defaultSiteSettings(), name: 'Renamed', customCss: '.x{color:red}' };
    const row = await websiteOf(runtime).designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: settings,
    });
    await websiteOf(runtime).designs.publish(spaceId, row.id);
    const second = await echoOf(await get('http://site.test/about'));
    expect(second.cssHref).not.toBe(first.cssHref);
    expect(await (await get(`http://site.test${second.cssHref}`)).text()).toContain(
      '.x{color:red}',
    );
    expect(rendered.at(-1)?.site.name).toBe('Renamed');
  });
});

describe('site share links', () => {
  it('shows drafts and draft designs behind a share cookie, never cached', async () => {
    expect((await get('http://site.test/draft-only')).status).toBe(404);

    const { token } = await websiteOf(runtime).designs.createShareLink(spaceId, {});
    const landing = await get(`http://site.test/_manablox/share/${token}`);
    expect(landing.status).toBe(302);
    expect(landing.headers.get('location')).toBe('/');
    const cookie = landing.headers.get('set-cookie') as string;
    expect(cookie).toContain('mb_site_share=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/Max-Age=\d+/);

    const headers = { cookie: cookie.split(';')[0] as string };
    const draft = await get('http://site.test/draft-only', headers);
    expect(draft.status).toBe(200);
    expect(draft.headers.get('x-robots-tag')).toContain('noindex');
    expect(draft.headers.get('cache-control')).toBe('private, no-store');
    expect(await echoOf(draft)).toMatchObject({ title: 'Draft only', mode: 'share' });

    const robots = await get('http://site.test/robots.txt', headers);
    expect(await robots.text()).toContain('Disallow: /');
  });

  it('lands on the shared document and refuses other spaces or bad tokens', async () => {
    const draft = await createPage(spaceId, { title: 'Shared', slug: 'shared' });
    const { token } = await websiteOf(runtime).designs.createShareLink(spaceId, {
      contentId: draft.id,
    });
    const landing = await get(`http://site.test/_manablox/share/${token}`);
    expect(landing.headers.get('location')).toBe('/shared');
    const headers = {
      cookie: (landing.headers.get('set-cookie') as string).split(';')[0] as string,
    };
    expect((await get('http://site.test/shared', headers)).status).toBe(200);
    // One document's link shows no other draft.
    expect((await get('http://site.test/draft-only', headers)).status).toBe(404);
    // Live pages seen through a share link stay out of shared caches too.
    const live = await get('http://site.test/about', headers);
    expect(live.status).toBe(200);
    expect(live.headers.get('cache-control')).toBe('private, no-store');

    expect((await get('http://site.test/_manablox/share/forged.token')).status).toBe(404);
    expect((await get(`http://external.test/_manablox/share/${token}`)).status).toBe(404);
  });
});

describe('site sitemap and robots', () => {
  it('lists published documents with their translations', async () => {
    const response = await get('http://site.test/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    const xml = await response.text();
    expect(xml).toContain('<loc>http://site.test/</loc>');
    expect(xml).toContain('<loc>http://site.test/about</loc>');
    expect(xml).toContain('hreflang="de" href="http://site.test/de/ueber-uns"');
    expect(xml).not.toContain('draft-only');
  });

  it('leaves out what the read hooks hide from delivery', async () => {
    await runtime.cache.clear();
    const off = runtime.manablox.hooks.on('content:afterRead', (row) =>
      row?.title === 'About' ? null : row,
    );
    try {
      const xml = await (await get('http://site.test/sitemap.xml')).text();
      expect(xml).toContain('<loc>http://site.test/</loc>');
      expect(xml).not.toContain('<loc>http://site.test/about</loc>');
    } finally {
      off();
      await runtime.cache.clear();
    }
  });

  it('allows crawling and names the sitemap', async () => {
    const text = await (await get('http://site.test/robots.txt')).text();
    expect(text).toContain('Allow: /');
    expect(text).toContain('Sitemap: http://site.test/sitemap.xml');
  });

  it('disallows everything when the site is not indexed', async () => {
    const current = await websiteOf(runtime).designs.get(spaceId, 'site', 'default');
    const row = await websiteOf(runtime).designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: { ...(current.data as object), robots: { index: false } },
      expectedVersion: current.design?.version ?? 0,
    });
    await websiteOf(runtime).designs.publish(spaceId, row.id);
    expect(await (await get('http://site.test/robots.txt')).text()).toContain('Disallow: /');
    expect((await get('http://site.test/sitemap.xml')).status).toBe(404);
    expect((await get('http://site.test/about')).headers.get('x-robots-tag')).toContain('noindex');
  });
});

describe('site canvas', () => {
  it('may be framed by the editor origin only', async () => {
    const response = await get('http://site.test/_manablox/canvas');
    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy') as string;
    expect(csp).toContain('frame-ancestors http://admin.test');
    expect(response.headers.get('x-frame-options')).toBeNull();
    expect(await response.text()).toContain('data-editor="http://admin.test"');
  });
});

describe('site media', () => {
  const upload = (space: string, name: string) =>
    runtime.media.upload({
      spaceId: space,
      filename: `${name}.txt`,
      mimeType: 'text/plain',
      // Uploads are deduplicated by content.
      body: Buffer.from(name),
    });

  it('serves assets the live designs use, and nothing else of the space', async () => {
    const logo = await upload(spaceId, 'logo');
    const unused = await upload(spaceId, 'unused');
    expect((await get(`http://site.test/media/${logo.id}/original`)).status).toBe(404);

    const current = await websiteOf(runtime).designs.get(spaceId, 'site', 'default');
    const row = await websiteOf(runtime).designs.saveDraft(spaceId, {
      kind: 'site',
      key: 'default',
      draft: { ...(current.data as object), logo: { assetId: logo.id } },
      expectedVersion: current.design?.version ?? 0,
    });
    await websiteOf(runtime).designs.publish(spaceId, row.id);

    const served = await get(`http://site.test/media/${logo.id}/original`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toContain('text/plain');
    expect((await get(`http://site.test/media/${unused.id}/original`)).status).toBe(404);
    // Only through a host of its own space.
    expect((await get(`http://external.test/media/${logo.id}/original`)).status).toBe(404);
    expect((await get(`http://nobody.test/media/${logo.id}/original`)).status).toBe(404);
    expect(rendered.length).toBeGreaterThan(0);
    const page = await get('http://site.test/about');
    expect(page.status).toBe(200);
    expect(rendered.at(-1)?.assets[logo.id]?.url).toBe(`/media/${logo.id}/original`);
    expect(served.headers.get('cache-control')).toContain('public');
  });

  it('serves other assets of the space privately behind a share cookie', async () => {
    const draftOnly = await upload(spaceId, 'draft-asset');
    const { token } = await websiteOf(runtime).designs.createShareLink(spaceId, {});
    const landing = await get(`http://site.test/_manablox/share/${token}`);
    const headers = {
      cookie: (landing.headers.get('set-cookie') as string).split(';')[0] as string,
    };
    expect((await get(`http://site.test/media/${draftOnly.id}/original`)).status).toBe(404);
    const shared = await get(`http://site.test/media/${draftOnly.id}/original`, headers);
    expect(shared.status).toBe(200);
    expect(shared.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('site with the real renderer', () => {
  it('renders a page with its stylesheet, islands and fonts', async () => {
    // Pages rendered by the stub above are cached.
    await runtime.cache.clear();
    const real = await createApp(runtime, {
      mode: websiteMode({ editorOrigin: 'http://admin.test' }),
    });
    const fetch = (url: string) => real.request(new Request(url));
    const response = await fetch('http://site.test/about');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<title>About');
    const css = /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1] as string;
    expect(css).toMatch(/^\/_site\/[A-Za-z0-9_-]+\.css$/);
    expect((await fetch(`http://site.test${css}`)).status).toBe(200);
    for (const [, src] of html.matchAll(/<script type="module" src="([^"]+)"/g)) {
      const script = await fetch(`http://site.test${src}`);
      expect(script.status, src).toBe(200);
      expect(script.headers.get('content-type')).toContain('javascript');
    }
    const font = await fetch('http://site.test/_site/fonts/inter/Inter-Variable.woff2');
    expect(font.status).toBe(200);
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1000);

    const canvas = await fetch('http://site.test/_manablox/canvas');
    const src = /<script type="module" src="([^"]+)"/.exec(await canvas.text())?.[1] as string;
    expect(src).toMatch(/^\/_site\/canvas\.[a-f0-9]+\.js$/);
    expect((await fetch(`http://site.test${src}`)).status).toBe(200);
  }, 60_000);
});
