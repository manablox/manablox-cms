import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseRedirectPath } from '../src/redirect.service.js';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('redirects', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;

/** A space of its own, so listing checks see only this test's rows. */
const freshSpace = async (locales = ['en']) => {
  const name = `redirects-${++counter}`;
  return (
    await ctx.repos.spaces.create({
      name,
      machineName: name,
      url: 'http://t.test',
      defaultLocale: locales[0] as string,
      locales,
    })
  ).id;
};

const article = (spaceId: string, slug: string, parentId: string | null = null) =>
  ctx.content.create({
    spaceId,
    typeId: ctx.ids.article as string,
    locale: 'en',
    parentId,
    title: slug,
    slug,
    fields: {},
  });

const reslug = (spaceId: string, row: Awaited<ReturnType<typeof article>>, slug: string) =>
  ctx.content.update(spaceId, row.id, {
    spaceId,
    typeId: row.typeId,
    locale: row.locale,
    parentId: row.parentId,
    title: row.title,
    slug,
    fields: {},
  });

describe('redirects', () => {
  it('normalises paths', () => {
    expect(normaliseRedirectPath('/a//b/')).toBe('/a/b');
    expect(normaliseRedirectPath('/')).toBe('/');
    expect(normaliseRedirectPath('a/b')).toBeNull();
    expect(normaliseRedirectPath('/a?b=1')).toBeNull();
  });

  it('manages manual redirects and flattens chains', async () => {
    const spaceId = await freshSpace(['en', 'de']);
    const a = await ctx.redirects.create(spaceId, { fromPath: '/old/', toPath: '/new' });
    expect(a).toMatchObject({ fromPath: '/old', toPath: '/new', status: 301, source: 'manual' });

    // A redirect to `/old` goes straight to `/new`.
    const b = await ctx.redirects.create(spaceId, { fromPath: '/older', toPath: '/old' });
    expect(b.toPath).toBe('/new');

    // A redirect from `/new` retargets the ones leading to it.
    await ctx.redirects.create(spaceId, {
      fromPath: '/new',
      toPath: 'https://example.com/x',
      status: 302,
    });
    expect((await ctx.redirects.get(spaceId, a.id)).toPath).toBe('https://example.com/x');

    await expect(
      ctx.redirects.create(spaceId, { fromPath: '/old', toPath: '/x' }),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'redirect.fromPath.taken' })],
    });
    await expect(
      ctx.redirects.create(spaceId, { fromPath: '/self', toPath: '/self' }),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'redirect.target.self' })],
    });
    await expect(ctx.redirects.create(spaceId, { fromPath: '/none' })).rejects.toMatchObject({
      details: [expect.objectContaining({ key: 'redirect.target.required' })],
    });

    // One per locale, and a shared one for every locale.
    await ctx.redirects.create(spaceId, { fromPath: '/p', toPath: '/shared' });
    await ctx.redirects.create(spaceId, { fromPath: '/p', toPath: '/german', locale: 'de' });
    expect((await ctx.redirects.lookup(spaceId, 'de', '/p/'))?.toPath).toBe('/german');
    expect((await ctx.redirects.lookup(spaceId, 'en', '/p'))?.toPath).toBe('/shared');
    const none = await ctx.redirects.lookup(spaceId, 'en', '/nothing');
    expect(none).toBeNull();

    const page = await ctx.redirects.list(spaceId, { search: 'old' }, { limit: 10, offset: 0 });
    expect(page.items.map((row) => row.fromPath)).toEqual(['/old', '/older']);

    await ctx.redirects.delete(spaceId, b.id);
    await expect(ctx.redirects.get(spaceId, b.id)).rejects.toMatchObject({
      key: 'redirect.notFound',
    });
  });

  it('filters the list by locale and names document targets', async () => {
    const spaceId = await freshSpace(['en', 'de']);
    const doc = await article(spaceId, 'target');
    await ctx.redirects.create(spaceId, { fromPath: '/a', toContentId: doc.localizationId });
    await ctx.redirects.create(spaceId, { fromPath: '/b', toPath: '/x', locale: 'de' });
    await ctx.redirects.create(spaceId, {
      fromPath: '/c',
      toContentId: doc.localizationId,
      locale: 'en',
    });
    const page = { limit: 10, offset: 0 };

    const en = await ctx.redirects.list(spaceId, { locale: 'en' }, page);
    expect(en.items.map((row) => [row.fromPath, row.toTitle])).toEqual([
      ['/a', 'target'],
      ['/c', 'target'],
    ]);
    const de = await ctx.redirects.list(spaceId, { locale: 'de' }, page);
    expect(de.items.map((row) => [row.fromPath, row.toTitle])).toEqual([
      ['/a', 'target'],
      ['/b', null],
    ]);
    expect((await ctx.redirects.list(spaceId, {}, page)).total).toBe(3);
  });

  it('records a 301 when a publish changes a live permalink, and drops redirects of live paths', async () => {
    const spaceId = await freshSpace();
    const parent = await article(spaceId, 'blog');
    const child = await article(spaceId, 'post', parent.id);
    await ctx.content.publish(spaceId, parent.id);
    await ctx.content.publish(spaceId, child.id);
    const live = await ctx.repos.content.findById(child.id, true);
    expect(live?.permalink).toBe('blog/post');

    // A manual redirect to the child's old path will follow it.
    const manual = await ctx.redirects.create(spaceId, {
      fromPath: '/x',
      toPath: '/blog/post',
    });

    await reslug(spaceId, parent, 'news');
    await ctx.content.publish(spaceId, parent.id);

    const auto = await ctx.redirects.list(spaceId, { source: 'auto' }, { limit: 10, offset: 0 });
    expect(
      auto.items.map((row) => [row.fromPath, row.toContentId, row.locale, row.status]),
    ).toEqual([
      ['/blog', parent.localizationId, 'en', 301],
      ['/blog/post', child.localizationId, 'en', 301],
    ]);
    const chained = await ctx.redirects.get(spaceId, manual.id);
    expect(chained).toMatchObject({ toPath: null, toContentId: child.localizationId });

    // Moving back makes `/blog` live again, so its redirect goes; `/news` gets one.
    await reslug(spaceId, parent, 'blog');
    await ctx.content.publish(spaceId, parent.id);
    const after = await ctx.redirects.list(spaceId, { source: 'auto' }, { limit: 10, offset: 0 });
    expect(after.items.map((row) => row.fromPath)).toEqual(['/news', '/news/post']);

    // A new document on a redirected path takes over the locale's redirect.
    await ctx.redirects.create(spaceId, { fromPath: '/fresh', toPath: '/blog', locale: 'en' });
    const fresh = await article(spaceId, 'fresh');
    await ctx.content.publish(spaceId, fresh.id);
    expect(await ctx.redirects.lookup(spaceId, 'en', '/fresh')).toBeNull();
  });

  it('audits redirect writes', async () => {
    const spaceId = await freshSpace();
    const row = await ctx.redirects.create(spaceId, { fromPath: '/a', toPath: '/b' });
    await ctx.redirects.update(spaceId, row.id, { fromPath: '/a', toPath: '/c' });
    await ctx.redirects.delete(spaceId, row.id);
    const entries = await ctx.repos.audit.page({ spaceId, targetKind: 'redirect' });
    expect(entries.items.map((entry) => entry.action).sort()).toEqual([
      'redirect.create',
      'redirect.delete',
      'redirect.update',
    ]);
  });
});
