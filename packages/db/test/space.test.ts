import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('space');
});
afterAll(async () => {
  await ctx?.close();
});

let counter = 0;
const space = (data: Partial<Parameters<typeof ctx.repos.spaces.create>[0]> = {}) => {
  const machineName = `space_${++counter}`;
  return ctx.repos.spaces.create({ name: machineName, machineName, url: 'http://s.test', ...data });
};

describe('spaces', () => {
  it('creates with defaults: locale en, locales from the default locale, empty settings', async () => {
    const plain = await space();
    expect(plain).toMatchObject({
      defaultLocale: 'en',
      locales: ['en'],
      settings: {},
      description: null,
    });
    const german = await space({ defaultLocale: 'de' });
    expect(german.locales).toEqual(['de']);
  });

  it('keeps a given id, as an import does', async () => {
    const id = crypto.randomUUID();
    expect((await space({ id })).id).toBe(id);
  });

  it('refuses a second space with the same machine name', async () => {
    const first = await space();
    await expect(
      ctx.repos.spaces.create({ name: 'Dup', machineName: first.machineName, url: 'x' }),
    ).rejects.toSatisfy((error: unknown) => isUniqueViolation(error, 'machine_name'));
  });

  it('lists by name and looks up by id, ids and machine name', async () => {
    const b = await space({ name: 'zz second' });
    const a = await space({ name: 'zz first' });
    const names = (await ctx.repos.spaces.list()).map((row) => row.name);
    expect(names.indexOf('zz first')).toBeLessThan(names.indexOf('zz second'));

    expect((await ctx.repos.spaces.listByIds([b.id, a.id])).map((row) => row.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(await ctx.repos.spaces.listByIds([])).toEqual([]);
    expect((await ctx.repos.spaces.findById(a.id))?.name).toBe('zz first');
    expect((await ctx.repos.spaces.findByMachineName(b.machineName))?.id).toBe(b.id);
    expect(await ctx.repos.spaces.findByMachineName('missing')).toBeNull();
  });

  it('update patches only the given fields and bumps updatedAt', async () => {
    const row = await space({ description: 'keep', settings: { a: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await ctx.repos.spaces.update(row.id, {
      name: 'Renamed',
      locales: ['en', 'de'],
    });
    expect(updated).toMatchObject({
      name: 'Renamed',
      machineName: row.machineName,
      description: 'keep',
      locales: ['en', 'de'],
      settings: { a: 1 },
    });
    expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
    expect((await ctx.repos.spaces.update(row.id, { description: null })).description).toBeNull();
  });

  it('update of an unknown space is not found', async () => {
    await expect(ctx.repos.spaces.update(crypto.randomUUID(), { name: 'x' })).rejects.toMatchObject(
      { key: 'space.notFound', kind: 'not_found' },
    );
  });

  it('keeps import state until the import finishes, and claims only a failed or idle one', async () => {
    const progress = {
      id: crypto.randomUUID(),
      done: 1,
      total: 4,
      step: 'contents:1',
      actorId: null,
      selection: {},
      resumable: true,
      notes: [],
      error: null,
    };
    const row = await space();
    expect(row).toMatchObject({ importStatus: null, importProgress: null });
    const importing = await ctx.repos.spaces.create(
      { name: 'In', machineName: `space_${++counter}`, url: 'http://s.test' },
      { status: 'importing', progress },
    );
    expect(importing).toMatchObject({ importStatus: 'importing', importProgress: progress });

    // Still running, and fresh.
    const longAgo = new Date(Date.now() - 60_000);
    expect(await ctx.repos.spaces.claimImport(importing.id, longAgo)).toBeNull();
    // Idle since before the cut-off.
    expect(
      await ctx.repos.spaces.claimImport(importing.id, new Date(Date.now() + 1000)),
    ).toMatchObject({ importStatus: 'importing' });

    const failed = { ...progress, error: { key: 'internal.error', message: 'x' } };
    await ctx.repos.spaces.setImport(importing.id, 'failed', failed);
    expect(await ctx.repos.spaces.findById(importing.id)).toMatchObject({
      importStatus: 'failed',
      importProgress: failed,
    });
    expect(await ctx.repos.spaces.claimImport(importing.id, longAgo)).toMatchObject({
      importStatus: 'importing',
    });
    // A ready space is never claimed.
    expect(await ctx.repos.spaces.claimImport(row.id, new Date(Date.now() + 1000))).toBeNull();

    await ctx.repos.spaces.setImport(importing.id, null, null);
    expect(await ctx.repos.spaces.findById(importing.id)).toMatchObject({
      importStatus: null,
      importProgress: null,
    });
  });

  it('delete answers whether a space went', async () => {
    const row = await space();
    expect(await ctx.repos.spaces.delete(row.id)).toBe(true);
    expect(await ctx.repos.spaces.delete(row.id)).toBe(false);
    expect(await ctx.repos.spaces.findById(row.id)).toBeNull();
  });
});
