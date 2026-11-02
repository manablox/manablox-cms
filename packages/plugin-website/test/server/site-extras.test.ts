import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '@manablox/auth';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { builtinFieldTypes } from '@manablox/fields';
import {
  bootstrap,
  createApp,
  type ManagementRuntime,
  type Runtime,
  requireManagement,
} from '@manablox/server';
import { spaceGroup, withControls } from '@manablox/services/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SiteRenderer, websitePlugin } from '../../src/index.js';
import { siteCacheTags } from '../../src/shared/site.js';
import { websiteOf } from '../helpers/runtime.js';

let db: TestDatabase;
let dir: string;
let api: ManagementRuntime;
let site: Runtime;
let siteApp: Hono;
let spaceA: string;

/** Echoes the badge it is given. */
const renderer: SiteRenderer = {
  renderPage: async (input, options) => ({
    html: `<!doctype html><title>${input.document?.title ?? 'Not found'}</title>${
      options?.badge
        ? `<a class="badge" href="${options.badge.link}">${options.badge.text}</a>`
        : ''
    }`,
    status: input.status,
  }),
  clientFile: async () => null,
  font: async () => null,
  canvasPage: async () => '',
};

const get = (url: string, headers: Record<string, string> = {}) =>
  siteApp.request(new Request(url, { headers }));

/** Control writes reach the site process: its controls are forgotten at once. */
const controls = async (options: Parameters<typeof withControls>[1]) => {
  const restore = await withControls(api, options);
  site.controlStore.forget(null);
  return async () => {
    await restore();
    site.controlStore.forget(null);
  };
};

const designedSpace = async (name: string, hostname: string) => {
  const space = await api.repos.spaces.create({
    name,
    machineName: name,
    url: 'http://unused.test',
    defaultLocale: 'en',
    locales: ['en'],
  });
  await websiteOf(api).settings.set(space.id, { mode: 'designed' });
  await websiteOf(api).domains.create(space.id, { hostname });
  const typeId = api.manablox.contentTypes.getByName('page').id;
  const about = await api.content.create({
    spaceId: space.id,
    typeId,
    title: 'About',
    slug: 'about',
    fields: {},
  });
  await api.content.publish(space.id, about.id);
  await api.content.create({
    spaceId: space.id,
    typeId,
    title: 'Draft',
    slug: 'draft',
    fields: {},
  });
  return space.id;
};

beforeAll(async () => {
  db = await createTestDatabase('server_site_extras', {
    plugins: [websitePlugin()],
  });
  dir = await mkdtemp(join(tmpdir(), 'manablox-site-extras-'));
  const config = {
    plugins: [websitePlugin({ renderer })],
    database: { url: db.url },
    auth: { secret: 'site-extras-secret' },
    fieldTypes: builtinFieldTypes,
    contentTypes: [{ name: 'page', fields: [] }],
    logLevel: 'silent' as const,
    cache: { enabled: true, ttl: 300 },
    storage: { driver: 'local' as const, local: { path: join(dir, 'files') } },
  };
  api = requireManagement(await bootstrap({ ...config, server: { rateLimit: false } }));
  site = await bootstrap({ ...config, server: { mode: 'website', rateLimit: false } });
  // Stands in for Redis: a purge on the API reaches the site's caches, shared and local.
  api.manablox.hooks.on('cache:purge', async ({ tags }) => {
    await site.manablox.hooks.run(
      'cache:purge',
      { tags },
      { manablox: site.manablox, spaceId: null },
    );
  });
  siteApp = await createApp(site);
  spaceA = await designedSpace('a', 'a.test');
  await designedSpace('b', 'b.test');
}, 60_000);

afterAll(async () => {
  await site?.shutdown();
  await api?.shutdown();
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('site badge', () => {
  it('is off by default; on at the instance it shows the catalogue text and link', async () => {
    expect(await (await get('http://a.test/about')).text()).not.toContain('class="badge"');
    const restore = await controls({ features: { 'plugins.website.badge': true } });
    try {
      expect(await (await get('http://a.test/about')).text()).toContain(
        '<a class="badge" href="https://manablox.io">Made with Manablox</a>',
      );
    } finally {
      await restore();
    }
    expect(await (await get('http://a.test/about')).text()).not.toContain('class="badge"');
  });

  it('takes text and link from the most specific scope that sets them', async () => {
    const group = await spaceGroup(api, [spaceA], 'Badge');
    const restores = [
      await controls({ features: { 'plugins.website.badge': true } }),
      await controls({
        scope: group,
        values: { 'plugins.website.badge.text': 'Built with Manablox' },
      }),
      await controls({
        scope: { kind: 'space', id: spaceA },
        values: { 'plugins.website.badge.link': 'https://example.com/made' },
      }),
    ];
    try {
      expect(await (await get('http://a.test/about')).text()).toContain(
        '<a class="badge" href="https://example.com/made">Built with Manablox</a>',
      );
      expect(await (await get('http://b.test/about')).text()).toContain('Made with Manablox');

      // Off in one space, while the instance has it on.
      restores.push(
        await controls({
          scope: { kind: 'space', id: spaceA },
          features: { 'plugins.website.badge': false },
        }),
      );
      expect(await (await get('http://a.test/about')).text()).not.toContain('class="badge"');
      expect(await (await get('http://b.test/about')).text()).toContain('class="badge"');
    } finally {
      for (const restore of restores.reverse()) await restore();
      await api.controls.deleteGroup({ id: group.id });
      site.controlStore.forget(null);
    }
  });

  it('a toggle purges the cached pages, so the served HTML changes at once', async () => {
    const page = await get('http://b.test/about');
    expect(await page.text()).not.toContain('class="badge"');
    // Cached now.
    expect(await (await get('http://b.test/about')).text()).not.toContain('class="badge"');

    const restore = await controls({ features: { 'plugins.website.badge': true } });
    try {
      // The write purged every page: none is left under the tag.
      expect(await site.cache.purge([siteCacheTags.pages])).toBe(0);
      expect(await (await get('http://b.test/about')).text()).toContain('class="badge"');
    } finally {
      await restore();
    }
    expect(await (await get('http://b.test/about')).text()).not.toContain('class="badge"');
  });
});

describe('site password', () => {
  let spaceP: string;
  const post = (body: string, headers: Record<string, string> = {}) =>
    siteApp.request(
      new Request('http://p.test/_manablox/password', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      }),
    );
  const cookieOf = (response: Response) =>
    (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
  const signIn = async (password: string) => {
    const response = await post(`password=${encodeURIComponent(password)}&next=%2Fabout`);
    expect(response.status).toBe(303);
    return { cookie: cookieOf(response) };
  };

  beforeAll(async () => {
    spaceP = await designedSpace('p', 'p.test');
    // Cached while still open.
    expect((await get('http://p.test/about')).status).toBe(200);
    await websiteOf(api).settings.set(spaceP, { passwordHash: await hashPassword('open sesame') });
  });

  it('answers every page with the neutral password form, never cached or indexed', async () => {
    for (const path of ['/about', '/', '/nowhere']) {
      const response = await get(`http://p.test${path}`);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      const html = await response.text();
      expect(html).toContain('Password required');
      expect(html).toContain(`name="next" value="${path}"`);
      expect(html).not.toContain('About');
    }
  });

  it('refuses a wrong password and lets the right one in with a signed cookie', async () => {
    const wrong = await post('password=nope&next=%2Fabout');
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(await wrong.text()).toContain('not right');

    const right = await post('password=open+sesame&next=%2Fabout');
    expect(right.status).toBe(303);
    expect(right.headers.get('location')).toBe('/about');
    const set = right.headers.get('set-cookie') ?? '';
    expect(set).toMatch(/^mb_site_access=/);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    expect(set).not.toContain('Secure');

    const secure = await post('password=open+sesame', { 'x-forwarded-proto': 'https' });
    expect(secure.headers.get('set-cookie')).toContain('Secure');
    expect(secure.headers.get('location')).toBe('/');

    // An outside `next` falls back to the home page.
    const outside = await post('password=open+sesame&next=%2F%2Fevil.test');
    expect(outside.headers.get('location')).toBe('/');

    const page = await get('http://p.test/about', { cookie: cookieOf(right) });
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('private, no-store');
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await page.text()).toContain('About');

    // Bound to its space: another site does not take it.
    const forged = 'mb_site_access=9999999999.abc';
    expect((await get('http://p.test/about', { cookie: forged })).status).toBe(401);
  });

  it('never writes protected pages into the shared cache; open sites still cache', async () => {
    const { cookie } = await signIn('open sesame');
    await site.cache.purge([siteCacheTags.pages]);
    expect((await get('http://p.test/about', { cookie })).status).toBe(200);
    expect((await get('http://p.test/nowhere', { cookie })).status).toBe(404);
    expect(await site.cache.purge([siteCacheTags.pages])).toBe(0);

    const open = await get('http://b.test/about');
    expect(open.status).toBe(200);
    expect(open.headers.get('cache-control')).not.toContain('private');
    expect(open.headers.get('x-robots-tag')).toBeNull();
    expect(await site.cache.purge([siteCacheTags.pages])).toBeGreaterThan(0);
  });

  it('keeps robots out: robots.txt disallows all, no sitemap', async () => {
    const robots = await get('http://p.test/robots.txt');
    expect(await robots.text()).toContain('Disallow: /');
    expect(robots.headers.get('cache-control')).toBe('private, no-store');
    expect((await get('http://p.test/sitemap.xml')).status).toBe(404);
    expect(await (await get('http://b.test/robots.txt')).text()).toContain('Allow: /');
  });

  it('takes no form posts from a visitor without the cookie', async () => {
    const response = await siteApp.request(
      new Request('http://p.test/_manablox/forms/page/x/contact', {
        method: 'POST',
        body: 'a=1',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('share links preview without the password', async () => {
    const { token } = await websiteOf(api).designs.createShareLink(spaceP, {});
    const landing = await get(`http://p.test/_manablox/share/${token}`);
    expect(landing.status).toBe(302);
    const cookie = cookieOf(landing);
    const draft = await get('http://p.test/draft', { cookie });
    expect(draft.status).toBe(200);
    expect(await draft.text()).toContain('Draft');
  });

  it('a new password ends every earlier cookie', async () => {
    const old = await signIn('open sesame');
    expect((await get('http://p.test/about', old)).status).toBe(200);
    await websiteOf(api).settings.set(spaceP, { passwordHash: await hashPassword('new secret') });
    expect((await get('http://p.test/about', old)).status).toBe(401);
    expect((await post('password=open+sesame')).status).toBe(401);
    const fresh = await signIn('new secret');
    expect((await get('http://p.test/about', fresh)).status).toBe(200);
  });

  it('while sitePassword is off, the site stays protected and the password stays', async () => {
    const restore = await controls({
      scope: { kind: 'space', id: spaceP },
      features: { 'plugins.website.password': false },
    });
    try {
      expect((await get('http://p.test/about')).status).toBe(401);
      const { cookie } = await signIn('new secret');
      expect((await get('http://p.test/about', { cookie })).status).toBe(200);
      await expect(
        websiteOf(api).settings.set(spaceP, { passwordHash: null }),
      ).rejects.toMatchObject({ key: 'control.feature' });
    } finally {
      await restore();
    }
  });

  it('counts attempts per client and space against site.password', async () => {
    const restore = await controls({
      scope: { kind: 'space', id: spaceP },
      values: { 'rateLimits.plugins.website.password': { max: 2, windowSeconds: 60 } },
    });
    try {
      const from = { 'x-forwarded-for': '203.0.113.9' };
      expect((await post('password=a', from)).status).toBe(401);
      expect((await post('password=b', from)).status).toBe(401);
      const refused = await post('password=new+secret', from);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
      expect(refused.headers.get('set-cookie')).toBeNull();
      expect(await refused.text()).toContain('Too many attempts');
    } finally {
      await restore();
    }
  });

  it('removing the password opens the site again', async () => {
    await websiteOf(api).settings.set(spaceP, { passwordHash: null });
    const page = await get('http://p.test/about');
    expect(page.status).toBe(200);
    expect(page.headers.get('x-robots-tag')).toBeNull();
  });
});
