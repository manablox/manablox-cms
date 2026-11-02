import { ContentTypeRegistry, FieldTypeRegistry } from '@manablox/core';
import {
  createDatabase,
  createRepositories,
  type DatabaseHandle,
  isUniqueViolation,
  type Repositories,
} from '@manablox/db';
import { createTestDatabase, type TestDatabase } from '@manablox/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { websiteRepos } from '../../src/server/db/index.js';
import { websitePlugin } from '../../src/server/plugin.js';

let database: TestDatabase;
let handle: DatabaseHandle;
const ctx = {} as { repos: Repositories };

beforeAll(async () => {
  database = await createTestDatabase('site', { plugins: [websitePlugin()] });
  handle = await createDatabase({ url: database.url, max: 4 });
  ctx.repos = createRepositories(handle, new ContentTypeRegistry(new FieldTypeRegistry()));
});
afterAll(async () => {
  await handle?.close();
  await database?.drop();
});

let counter = 0;
const freshSpace = async () => {
  const name = `site-${++counter}`;
  return (await ctx.repos.spaces.create({ name, machineName: name, url: 'http://t.test' })).id;
};

describe('site designs', () => {
  it('keeps a draft, publishes it and tracks what is dirty', async () => {
    const spaceId = await freshSpace();
    const row = await websiteRepos(ctx.repos).designs.create({
      spaceId,
      kind: 'theme',
      key: 'default',
      draft: { color: { primary: 'red' } },
    });
    expect(row).toMatchObject({ version: 1, published: null, publishedVersion: null });
    expect((await websiteRepos(ctx.repos).designs.listDirty(spaceId)).map((r) => r.id)).toEqual([
      row.id,
    ]);

    expect(await websiteRepos(ctx.repos).designs.saveDraft(row.id, 2, { draft: {} })).toBeNull();
    const saved = await websiteRepos(ctx.repos).designs.saveDraft(row.id, 1, {
      draft: { color: { primary: 'blue' } },
    });
    expect(saved?.version).toBe(2);

    const published = await websiteRepos(ctx.repos).designs.publish(row.id, null);
    expect(published).toMatchObject({
      published: { color: { primary: 'blue' } },
      publishedVersion: 2,
    });
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(await websiteRepos(ctx.repos).designs.listDirty(spaceId)).toEqual([]);

    await websiteRepos(ctx.repos).designs.saveDraft(row.id, 2, { draft: { changed: true } });
    const discarded = await websiteRepos(ctx.repos).designs.discardDraft(row.id, null);
    expect(discarded).toMatchObject({
      draft: { color: { primary: 'blue' } },
      version: 4,
      publishedVersion: 4,
    });
  });

  it('holds one design per space, kind and key', async () => {
    const spaceId = await freshSpace();
    await websiteRepos(ctx.repos).designs.create({ spaceId, kind: 'block', key: 'k', draft: {} });
    const error = await websiteRepos(ctx.repos)
      .designs.create({ spaceId, kind: 'block', key: 'k', draft: {} })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, 'site_designs')).toBe(true);
    // Another kind or space may use the key.
    await websiteRepos(ctx.repos).designs.create({ spaceId, kind: 'page', key: 'k', draft: {} });
    await websiteRepos(ctx.repos).designs.create({
      spaceId: await freshSpace(),
      kind: 'block',
      key: 'k',
      draft: {},
    });
  });

  it('lists versions newest first without data', async () => {
    const spaceId = await freshSpace();
    const row = await websiteRepos(ctx.repos).designs.create({
      spaceId,
      kind: 'site',
      key: 'default',
      draft: {},
    });
    const first = await websiteRepos(ctx.repos).designs.addVersion({
      designId: row.id,
      spaceId,
      version: 1,
      data: { a: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await websiteRepos(ctx.repos).designs.addVersion({
      designId: row.id,
      spaceId,
      version: 2,
      data: { a: 2 },
    });
    const versions = await websiteRepos(ctx.repos).designs.listVersions(row.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]).not.toHaveProperty('data');
    expect((await websiteRepos(ctx.repos).designs.findVersion(row.id, first.id))?.data).toEqual({
      a: 1,
    });
  });
});

describe('site domains', () => {
  it('finds hosts across spaces and one primary per locale', async () => {
    const spaceId = await freshSpace();
    const a = await websiteRepos(ctx.repos).domains.create(spaceId, {
      hostname: 'a.test',
      locale: null,
      isPrimary: true,
      redirectToPrimary: false,
    });
    const b = await websiteRepos(ctx.repos).domains.create(spaceId, {
      hostname: 'b.test',
      locale: null,
      isPrimary: true,
      redirectToPrimary: false,
    });
    await websiteRepos(ctx.repos).domains.create(spaceId, {
      hostname: 'de.test',
      locale: 'de',
      isPrimary: true,
      redirectToPrimary: false,
    });
    await websiteRepos(ctx.repos).domains.clearPrimary(spaceId, null, b.id);
    expect((await websiteRepos(ctx.repos).domains.findPrimary(spaceId, null))?.id).toBe(b.id);
    expect((await websiteRepos(ctx.repos).domains.findPrimary(spaceId, 'de'))?.hostname).toBe(
      'de.test',
    );
    expect((await websiteRepos(ctx.repos).domains.findByHostname('a.test'))?.id).toBe(a.id);

    const error = await websiteRepos(ctx.repos)
      .domains.create(await freshSpace(), {
        hostname: 'a.test',
        locale: null,
        isPrimary: false,
        redirectToPrimary: false,
      })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(error, 'hostname')).toBe(true);
  });
});

describe('space deletion', () => {
  it('takes every site row along', async () => {
    const spaceId = await freshSpace();
    const design = await websiteRepos(ctx.repos).designs.create({
      spaceId,
      kind: 'theme',
      key: 'default',
      draft: {},
    });
    await websiteRepos(ctx.repos).designs.addVersion({
      designId: design.id,
      spaceId,
      version: 1,
      data: {},
    });
    await websiteRepos(ctx.repos).domains.create(spaceId, {
      hostname: 'gone.test',
      locale: null,
      isPrimary: true,
      redirectToPrimary: false,
    });
    await ctx.repos.spaces.delete(spaceId);
    expect(await websiteRepos(ctx.repos).designs.listBySpace(spaceId)).toEqual([]);
    expect(await websiteRepos(ctx.repos).designs.listVersions(design.id)).toEqual([]);
    expect(await websiteRepos(ctx.repos).domains.findByHostname('gone.test')).toBeNull();
  });
});

describe('design version retention', () => {
  it('keeps the newest design versions by count, per design', async () => {
    const spaceId = await freshSpace();
    const designs = await Promise.all(
      ['a', 'b'].map((key) =>
        websiteRepos(ctx.repos).designs.create({ spaceId: spaceId, kind: 'block', key, draft: {} }),
      ),
    );
    for (const design of designs) {
      for (let version = 1; version <= 3; version++) {
        await websiteRepos(ctx.repos).designs.addVersion({
          designId: design.id,
          spaceId: spaceId,
          version,
          data: {},
        });
      }
    }
    const [a, b] = designs as [(typeof designs)[0], (typeof designs)[0]];
    await websiteRepos(ctx.repos).designs.pruneVersions(spaceId, 2, a.id);
    expect(
      (await websiteRepos(ctx.repos).designs.listVersions(a.id)).map((v) => v.version),
    ).toEqual([3, 2]);
    expect(await websiteRepos(ctx.repos).designs.listVersions(b.id)).toHaveLength(3);
    await websiteRepos(ctx.repos).designs.pruneVersions(spaceId, 1);
    expect(
      (await websiteRepos(ctx.repos).designs.listVersions(a.id)).map((v) => v.version),
    ).toEqual([3]);
    expect(
      (await websiteRepos(ctx.repos).designs.listVersions(b.id)).map((v) => v.version),
    ).toEqual([3]);
  });
});
