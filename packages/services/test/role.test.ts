import { builtinFieldTypes } from '@manablox/fields';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServiceContext, type ServiceContext } from '../src/testing.js';
import { TEST_TYPES } from './helpers/types.js';

let ctx: ServiceContext;

beforeAll(async () => {
  ctx = await createServiceContext('role', {
    fieldTypes: builtinFieldTypes,
    contentTypes: TEST_TYPES,
  });
});
afterAll(async () => {
  await ctx?.close();
});

const user = (email: string) =>
  ctx.repos.users.create({ name: email, email, role: 'editor', passwordHash: 'x' });

describe('roles', () => {
  it("lists the built-in five ahead of the space's own", async () => {
    await ctx.roles.create(ctx.spaceId, {
      name: 'Blogger',
      machineName: 'blogger',
      permissions: [`content:write:${ctx.ids.article}`],
    });
    const list = await ctx.roles.list(ctx.spaceId);
    expect(list.map((role) => role.machineName)).toEqual([
      'owner',
      'admin',
      'editor',
      'author',
      'viewer',
      'blogger',
    ]);
    expect(list[5]?.permissions).toEqual(
      expect.arrayContaining([
        'space:read',
        'contentType:read',
        `content:write:${ctx.ids.article}`,
      ]),
    );
  });

  it('refuses a reserved name, an unknown grant and a type the space lacks, each at its path', async () => {
    const error = await ctx.roles
      .create(ctx.spaceId, {
        name: '',
        machineName: 'owner',
        permissions: ['content:fly', `content:read:${crypto.randomUUID()}`],
      })
      .catch((err) => err);
    expect(error.key).toBe('role.validation.failed');
    expect(error.details.map((d: { key: string; path: unknown[] }) => [d.key, d.path])).toEqual([
      ['role.machineName.reserved', ['machineName']],
      ['role.name.required', ['name']],
      ['role.permission.unknown', ['permissions', 0]],
      ['role.permission.unknown', ['permissions', 1]],
    ]);
  });

  it('names a taken machine name on the field', async () => {
    await ctx.roles.create(ctx.spaceId, { name: 'A', machineName: 'taken', permissions: [] });
    const error = await ctx.roles
      .create(ctx.spaceId, { name: 'B', machineName: 'taken', permissions: [] })
      .catch((err) => err);
    expect(error.details).toEqual([
      { key: 'role.machineName.taken', path: ['machineName'], params: { machineName: 'taken' } },
    ]);
  });

  it('keeps a role someone holds and deletes one nobody does', async () => {
    const role = await ctx.roles.create(ctx.spaceId, {
      name: 'Held',
      machineName: 'held',
      permissions: [],
    });
    const holder = await user('holder@example.com');
    await ctx.spaces.grant(ctx.spaceId, holder.id, 'held');
    await expect(ctx.roles.delete(ctx.spaceId, role.id as string)).rejects.toMatchObject({
      key: 'role.inUse',
    });
    await ctx.spaces.revoke(ctx.spaceId, holder.id);
    await ctx.roles.delete(ctx.spaceId, role.id as string);
    await expect(ctx.roles.get(ctx.spaceId, role.id as string)).rejects.toMatchObject({
      key: 'role.notFound',
    });
  });

  it("grants a new type to the creator's narrowed role and prunes the grant when the type goes", async () => {
    const role = await ctx.roles.create(ctx.spaceId, {
      name: 'Narrow',
      machineName: 'narrow',
      permissions: ['contentType:write', `content:read:${ctx.ids.article}`],
    });
    const creator = await user('narrow@example.com');
    await ctx.spaces.grant(ctx.spaceId, creator.id, 'narrow');

    const type = await ctx.contentTypes.create(
      { name: 'note', spaceId: ctx.spaceId, fields: [] },
      creator.id,
    );
    const granted = await ctx.roles.get(ctx.spaceId, role.id as string);
    expect(granted.permissions).toEqual(
      expect.arrayContaining(
        ['read', 'write', 'delete', 'publish'].map((a) => `content:${a}:${type.id}`),
      ),
    );

    await ctx.contentTypes.delete(ctx.spaceId, type.id);
    const pruned = await ctx.roles.get(ctx.spaceId, role.id as string);
    expect(pruned.permissions.some((grant) => grant.endsWith(type.id))).toBe(false);
  });

  it('refuses a membership naming a role the space lacks', async () => {
    const someone = await user('someone@example.com');
    await expect(ctx.spaces.grant(ctx.spaceId, someone.id, 'ghost')).rejects.toMatchObject({
      key: 'space.member.roleNotFound',
    });
  });
});
