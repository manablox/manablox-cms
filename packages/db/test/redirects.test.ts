import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('redirects');
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const freshSpace = async () => {
  const name = `redirects-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;
};

describe('redirects', () => {
  it('looks up the locale before the shared redirect and keeps paths unique per locale', async () => {
    const spaceId = await freshSpace();
    const base = { toContentId: null, status: 301 };
    await ctx.repos.redirects.create(spaceId, {
      ...base,
      locale: null,
      fromPath: '/a',
      toPath: '/shared',
    });
    await ctx.repos.redirects.create(spaceId, {
      ...base,
      locale: 'de',
      fromPath: '/a',
      toPath: '/de',
    });
    expect((await ctx.repos.redirects.lookup(spaceId, 'de', '/a'))?.toPath).toBe('/de');
    expect((await ctx.repos.redirects.lookup(spaceId, 'en', '/a'))?.toPath).toBe('/shared');

    for (const locale of [null, 'de']) {
      const error = await ctx.repos.redirects
        .create(spaceId, { ...base, locale, fromPath: '/a', toPath: '/x' })
        .catch((e: unknown) => e);
      expect(isUniqueViolation(error, 'redirects_environment_locale_from')).toBe(true);
    }
  });

  it('records automatic redirects, retargets chains and drops live paths', async () => {
    const spaceId = await freshSpace();
    const doc = crypto.randomUUID();
    await ctx.repos.redirects.create(spaceId, {
      locale: null,
      fromPath: '/x',
      toPath: '/old',
      toContentId: null,
      status: 302,
    });
    await ctx.repos.redirects.upsertAuto(spaceId, [
      { locale: 'en', fromPath: '/old', toContentId: doc },
    ]);
    const auto = await ctx.repos.redirects.findByPath(spaceId, 'en', '/old');
    expect(auto).toMatchObject({ source: 'auto', status: 301, toContentId: doc, toPath: null });
    expect(await ctx.repos.redirects.findByPath(spaceId, null, '/x')).toMatchObject({
      toPath: null,
      toContentId: doc,
    });

    // Recording the same path again replaces it.
    const other = crypto.randomUUID();
    await ctx.repos.redirects.upsertAuto(spaceId, [
      { locale: 'en', fromPath: '/old', toContentId: other },
    ]);
    expect((await ctx.repos.redirects.findByPath(spaceId, 'en', '/old'))?.toContentId).toBe(other);

    expect(await ctx.repos.redirects.deleteLivePaths(spaceId, 'en', ['/old', '/nope'])).toBe(1);
    const page = await ctx.repos.redirects.page(spaceId, {}, { limit: 10, offset: 0 });
    expect(page.items.map((row) => row.fromPath)).toEqual(['/x']);
  });

  it('lists a locale with its own redirect before a shared one of the same path', async () => {
    const spaceId = await freshSpace();
    const base = { toContentId: null, status: 301 };
    await ctx.repos.redirects.create(spaceId, {
      ...base,
      locale: null,
      fromPath: '/a',
      toPath: '/s',
    });
    await ctx.repos.redirects.create(spaceId, {
      ...base,
      locale: 'de',
      fromPath: '/a',
      toPath: '/d',
    });
    await ctx.repos.redirects.create(spaceId, {
      ...base,
      locale: null,
      fromPath: '/b',
      toPath: '/s',
    });
    await ctx.repos.redirects.create(spaceId, {
      ...base,
      locale: 'fr',
      fromPath: '/c',
      toPath: '/f',
    });
    const rows = (await ctx.repos.redirects.inLocale(spaceId, 'de')).map((row) => [
      row.fromPath,
      row.toPath,
    ]);
    expect(rows).toEqual([
      ['/a', '/d'],
      ['/b', '/s'],
    ]);
  });

  it('are deleted with their space', async () => {
    const spaceId = await freshSpace();
    await ctx.repos.redirects.create(spaceId, {
      locale: null,
      fromPath: '/a',
      toPath: '/b',
      toContentId: null,
      status: 301,
    });
    await ctx.repos.spaces.delete(spaceId);
    expect((await ctx.repos.redirects.page(spaceId, {}, { limit: 5, offset: 0 })).total).toBe(0);
  });
});
