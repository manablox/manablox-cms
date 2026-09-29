import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('content_type');
});
afterAll(async () => {
  await ctx?.close();
});

const input = (name: string, label = name) => ({
  name,
  label,
  spaceId: ctx.spaceId,
  fields: [],
});

describe('content type fingerprint', () => {
  it('changes on create, update and delete, and only then', async () => {
    const before = await ctx.repos.contentTypes.fingerprint();
    expect(await ctx.repos.contentTypes.fingerprint()).toBe(before);

    const type = await ctx.repos.contentTypes.create(input('portfolio_page'));
    const created = await ctx.repos.contentTypes.fingerprint();
    expect(created).not.toBe(before);

    // Millisecond timestamps: an update in the same millisecond would not show.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ctx.repos.contentTypes.update(type.id, input('portfolio_page', 'Portfolio'));
    const updated = await ctx.repos.contentTypes.fingerprint();
    expect(updated).not.toBe(created);

    await ctx.repos.contentTypes.delete(type.id);
    const deleted = await ctx.repos.contentTypes.fingerprint();
    expect(deleted).not.toBe(updated);
    expect(deleted).toBe(before);
  });
});
