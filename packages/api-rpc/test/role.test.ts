import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { contentRouter } from '../src/routers/content.js';
import { roleRouter } from '../src/routers/role.js';
import { spaceRouter } from '../src/routers/space.js';
import { failure, invoke, mocks, principal, stubContext } from './helpers/rpc.js';

const row = (overrides = {}) => ({
  id: ids.role,
  spaceId: ids.space,
  name: 'Blogger',
  machineName: 'blogger',
  description: null,
  permissions: ['space:read', `content:write:${ids.type}`],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('roles.list', () => {
  it("lists the built-in roles ahead of the space's own", async () => {
    const ctx = stubContext();
    mocks(ctx).roles.listBySpace.mockResolvedValue([row()]);
    const list = await invoke<Array<{ machineName: string; builtIn: boolean }>>(
      roleRouter.list,
      { spaceId: ids.space },
      ctx,
    );
    expect(list.map((role) => role.machineName)).toEqual([
      'owner',
      'admin',
      'editor',
      'author',
      'viewer',
      'blogger',
    ]);
    expect(list.filter((role) => role.builtIn)).toHaveLength(5);
  });

  it('needs role:read, which an author lacks', async () => {
    const ctx = stubContext({ principal: principal({ spaces: { [ids.space]: 'author' } }) });
    expect(await failure(invoke(roleRouter.list, { spaceId: ids.space }, ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('roles.create', () => {
  it('refuses a built-in name, a bad grant and a type the space lacks - each at its path', async () => {
    const ctx = stubContext();
    const result = await failure(
      invoke(
        roleRouter.create,
        {
          spaceId: ids.space,
          name: 'Owner again',
          machineName: 'owner',
          permissions: ['content:write', 'nope:really', `content:read:${ids.otherType}`],
        },
        ctx,
      ),
    );
    expect(result.key).toBe('role.validation.failed');
    expect(result.details?.map((detail) => [detail.key, detail.path])).toEqual([
      ['role.machineName.reserved', ['machineName']],
      ['role.permission.unknown', ['permissions', 1]],
      ['role.permission.unknown', ['permissions', 2]],
    ]);
    expect(mocks(ctx).roles.create).not.toHaveBeenCalled();
  });

  it('always includes the reads the admin cannot render without', async () => {
    const ctx = stubContext();
    mocks(ctx).roles.create.mockImplementation(async (_spaceId, data) => row(data));
    const created = await invoke<{ permissions: string[] }>(
      roleRouter.create,
      {
        spaceId: ids.space,
        name: 'Blogger',
        machineName: 'blogger',
        permissions: [`content:write:${ids.type}`],
      },
      ctx,
    );
    expect(created.permissions).toEqual([
      'space:read',
      'contentType:read',
      `content:write:${ids.type}`,
    ]);
  });
});

describe('roles.delete', () => {
  it('refuses while a member still holds the role', async () => {
    const ctx = stubContext();
    mocks(ctx).roles.findById.mockResolvedValue(row());
    mocks(ctx).roles.countMembers.mockResolvedValue(2);
    expect(
      await failure(invoke(roleRouter.delete, { spaceId: ids.space, id: ids.role }, ctx)),
    ).toMatchObject({ code: 'CONFLICT', key: 'role.inUse' });
    expect(mocks(ctx).roles.delete).not.toHaveBeenCalled();
  });
});

describe('memberships and custom roles', () => {
  it('grants a custom role that exists and refuses one that does not', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.users.findSpaceRole.mockResolvedValue('editor');
    repos.roles.findByMachineName.mockImplementation(async (_space, name) =>
      name === 'blogger' ? row() : null,
    );

    await invoke(
      spaceRouter.grant,
      { spaceId: ids.space, userId: ids.otherUser, role: 'blogger' },
      ctx,
    );
    expect(repos.users.grant).toHaveBeenCalledWith(ids.otherUser, ids.space, 'blogger');

    expect(
      await failure(
        invoke(
          spaceRouter.grant,
          { spaceId: ids.space, userId: ids.otherUser, role: 'ghost' },
          ctx,
        ),
      ),
    ).toMatchObject({ key: 'space.member.roleNotFound' });
  });
});

describe('content permissions narrowed to a type', () => {
  it("checks a document's own type before deleting it", async () => {
    const ctx = stubContext({
      principal: principal({
        spaces: { [ids.space]: 'blogger' },
        permissions: { [ids.space]: ['space:read', `content:delete:${ids.type}`] },
      }),
      content: { delete: async () => 1 } as never,
    });
    const id = ids.doc;
    mocks(ctx).content.findById.mockResolvedValue({
      id,
      spaceId: ids.space,
      typeId: ids.otherType,
    });
    expect(
      await failure(invoke(contentRouter.delete, { spaceId: ids.space, id }, ctx)),
    ).toMatchObject({
      code: 'FORBIDDEN',
    });

    mocks(ctx).content.findById.mockResolvedValue({ id, spaceId: ids.space, typeId: ids.type });
    await expect(invoke(contentRouter.delete, { spaceId: ids.space, id }, ctx)).resolves.toEqual({
      ok: true,
    });
  });
});
