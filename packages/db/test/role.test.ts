import { ids } from '@manablox/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';
import { createRepositoryContext, type RepositoryTestContext } from './helpers/repository.js';

let ctx: RepositoryTestContext;

beforeAll(async () => {
  ctx = await createRepositoryContext('role');
});
afterAll(async () => {
  await ctx?.close();
});

const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

describe('RoleRepository and the principal', () => {
  it("resolves a membership naming a custom role to that role's grants", async () => {
    const role = await ctx.repos.roles.create(ctx.spaceId, {
      name: 'Blogger',
      machineName: `blogger-${stamp()}`,
      permissions: ['space:read', `content:write:${ctx.types.page.id}`],
    });
    const user = await ctx.repos.users.create({
      name: 'Blogger',
      email: `blogger-${stamp()}@example.com`,
      role: 'editor',
      passwordHash: 'x',
    });
    await ctx.repos.users.grant(user.id, ctx.spaceId, role.machineName);

    const principal = await ctx.repos.users.findPrincipal(user.id);
    expect(principal?.spaces).toEqual({ [ctx.spaceId]: role.machineName });
    expect(principal?.permissions).toEqual({ [ctx.spaceId]: role.permissions });
    expect(await ctx.repos.roles.countMembers(ctx.spaceId, role.machineName)).toBe(1);
  });

  it('carries no grants for a built-in role, which the auth package knows itself', async () => {
    const user = await ctx.repos.users.create({
      name: 'Editor',
      email: `editor-${stamp()}@example.com`,
      role: 'editor',
      passwordHash: 'x',
    });
    await ctx.repos.users.grant(user.id, ctx.spaceId, 'editor');
    const principal = await ctx.repos.users.findPrincipal(user.id);
    expect(principal?.spaces).toEqual({ [ctx.spaceId]: 'editor' });
    expect(principal?.permissions).toEqual({});
  });

  it('prunes the grants naming a content type from every role, keeping the rest', async () => {
    const gone = ids.missing;
    const a = await ctx.repos.roles.create(ctx.spaceId, {
      name: 'A',
      machineName: `a-${stamp()}`,
      permissions: ['space:read', `content:read:${gone}`, `content:write:${ctx.types.page.id}`],
    });
    const b = await ctx.repos.roles.create(ctx.spaceId, {
      name: 'B',
      machineName: `b-${stamp()}`,
      permissions: ['space:read', 'content:read'],
    });

    await ctx.repos.roles.pruneContentType(gone);

    expect((await ctx.repos.roles.findById(a.id))?.permissions).toEqual([
      'space:read',
      `content:write:${ctx.types.page.id}`,
    ]);
    expect((await ctx.repos.roles.findById(b.id))?.permissions).toEqual([
      'space:read',
      'content:read',
    ]);
  });

  it('refuses two roles with one machine name in a space', async () => {
    const machineName = `dup-${stamp()}`;
    const make = () =>
      ctx.repos.roles.create(ctx.spaceId, { name: 'Dup', machineName, permissions: [] });
    await make();
    await expect(make()).rejects.toSatisfy((error: unknown) =>
      isUniqueViolation(error, 'machine_name'),
    );
  });
});
