import { ids } from '@manablox/core/testing';
import { applySpaceStarter } from '@manablox/services';
import { describe, expect, it, vi } from 'vitest';
import { spaceRouter } from '../src/routers/space.js';
import {
  failure,
  invoke,
  mocks,
  principal,
  production,
  stubContext,
  superadmin,
} from './helpers/rpc.js';

// Only the decision to run the starter is under test.
vi.mock('@manablox/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@manablox/services')>()),
  applySpaceStarter: vi.fn(async () => ({
    contentTypes: 3,
    contents: 4,
    menus: 1,
    homeContentId: 'x',
  })),
}));

const space = (overrides = {}) => ({
  id: ids.space,
  name: 'Site',
  machineName: 'site',
  url: 'http://localhost:3002',
  defaultLocale: 'en',
  locales: ['en', 'de'],
  settings: {},
  ...overrides,
});

describe('spaces.list', () => {
  it('shows a member only their spaces and a superadmin every space', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.spaces.list.mockResolvedValue([space(), space({ id: ids.otherSpace })]);
    repos.spaces.listByIds.mockImplementation(async (spaceIds: string[]) =>
      [space(), space({ id: ids.otherSpace })].filter((s) => spaceIds.includes(s.id)),
    );

    const own = await invoke<unknown[]>(spaceRouter.list, undefined, ctx);
    expect(own).toHaveLength(1);
    // Bounded by membership.
    expect(repos.spaces.listByIds).toHaveBeenCalledWith([ids.space]);
    expect(repos.spaces.list).not.toHaveBeenCalled();

    const all = await invoke<unknown[]>(spaceRouter.list, undefined, {
      ...ctx,
      principal: superadmin(),
    });
    expect(all).toHaveLength(2);
  });

  it('confines a space-restricted key even for a superadmin', async () => {
    const ctx = stubContext({
      principal: superadmin(),
    });
    ctx.principal!.allowedSpaceIds = [ids.otherSpace];
    mocks(ctx).spaces.list.mockResolvedValue([space(), space({ id: ids.otherSpace })]);
    const visible = await invoke<Array<{ id: string }>>(spaceRouter.list, undefined, ctx);
    expect(visible.map((s) => s.id)).toEqual([ids.otherSpace]);
  });
});

describe('space groups', () => {
  it('never reach an editor', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    const grouped = space({ groupId: ids.otherSpace });
    repos.spaces.listByIds.mockResolvedValue([grouped]);
    repos.spaces.findById.mockResolvedValue(grouped);
    repos.spaces.update.mockResolvedValue(grouped);

    const [listed] = await invoke<Record<string, unknown>[]>(spaceRouter.list, undefined, ctx);
    expect(listed).toEqual(space());
    const got = await invoke<Record<string, unknown>>(spaceRouter.get, { spaceId: ids.space }, ctx);
    expect(got).not.toHaveProperty('groupId');
    const updated = await invoke<Record<string, unknown>>(
      spaceRouter.update,
      { spaceId: ids.space, name: 'Renamed' },
      ctx,
    );
    expect(updated).not.toHaveProperty('groupId');
  });
});

describe('spaces.create', () => {
  it('requires a superadmin', async () => {
    const ctx = stubContext();
    const result = await failure(invoke(spaceRouter.create, space(), ctx));
    expect(result.code).toBe('FORBIDDEN');
    expect(result.key).toBe('auth.superadminRequired');
  });

  it('rejects a default locale outside the locale list', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const result = await failure(
      invoke(spaceRouter.create, { ...space(), defaultLocale: 'fr' }, ctx),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(result.key).toBe('space.validation.failed');
  });

  it('makes the creator an owner', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.spaces.create!.mockResolvedValue(space());

    await invoke(spaceRouter.create, space(), ctx);
    expect(repos.users.grant).toHaveBeenCalledWith(ids.user, ids.space, 'owner');
  });

  it('applies a template only when asked, after the space exists', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.spaces.create!.mockResolvedValue(space());
    const starter = vi.mocked(applySpaceStarter);
    starter.mockClear();

    await invoke(spaceRouter.create, space(), ctx);
    expect(starter).not.toHaveBeenCalled();

    await invoke(spaceRouter.create, { ...space(), starter: true }, ctx);
    expect(starter).toHaveBeenCalledTimes(1);
    expect(starter).toHaveBeenCalledWith(
      ctx,
      space(),
      { userId: ids.user, roles: ['superadmin'] },
      'basic',
      undefined,
    );

    await invoke(spaceRouter.create, { ...space(), starter: 'portfolio' }, ctx);
    expect(starter).toHaveBeenLastCalledWith(
      ctx,
      space(),
      { userId: ids.user, roles: ['superadmin'] },
      'portfolio',
      undefined,
    );

    // The custom type takes the picked sections.
    await invoke(
      spaceRouter.create,
      { ...space(), starter: 'custom', blocks: ['hero', 'faq'] },
      ctx,
    );
    expect(starter).toHaveBeenLastCalledWith(
      ctx,
      space(),
      { userId: ids.user, roles: ['superadmin'] },
      'custom',
      ['hero', 'faq'],
    );
    await expect(
      invoke(spaceRouter.create, { ...space(), starter: 'custom', blocks: ['slider'] }, ctx),
    ).rejects.toThrow();
  });

  it('turns a taken machine name into a validation error', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.spaces.create!.mockRejectedValue(
      Object.assign(new Error('Failed query'), {
        cause: { code: '23505', message: 'duplicate key value violates "spaces_machine_name_key"' },
      }),
    );

    const result = await failure(invoke(spaceRouter.create, space(), ctx));
    expect(result.code).toBe('BAD_REQUEST');
    expect(result.key).toBe('space.validation.failed');
  });
});

describe('spaces.grant / revoke', () => {
  it('refuses to demote or remove the last owner', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.users.findSpaceRole!.mockResolvedValue('owner');
    repos.users.listMembersBySpace!.mockResolvedValue([{ userId: ids.user, role: 'owner' }]);

    const demote = await failure(
      invoke(spaceRouter.grant, { spaceId: ids.space, userId: ids.user, role: 'editor' }, ctx),
    );
    expect(demote.key).toBe('space.member.lastOwner');

    const remove = await failure(
      invoke(spaceRouter.revoke, { spaceId: ids.space, userId: ids.user }, ctx),
    );
    expect(remove.key).toBe('space.member.lastOwner');
    expect(repos.users.revoke).not.toHaveBeenCalled();
  });

  it('lets an owner be demoted once another owner exists', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.users.findSpaceRole!.mockResolvedValue('owner');
    repos.users.listMembersBySpace!.mockResolvedValue([
      { userId: ids.user, role: 'owner' },
      { userId: ids.otherUser, role: 'owner' },
    ]);

    await invoke(spaceRouter.grant, { spaceId: ids.space, userId: ids.user, role: 'editor' }, ctx);
    expect(repos.users.grant).toHaveBeenCalledWith(ids.user, ids.space, 'editor');
  });

  it('needs user:write in that space', async () => {
    const ctx = stubContext({ principal: principal({ spaces: { [ids.space]: 'editor' } }) });
    const result = await failure(
      invoke(spaceRouter.grant, { spaceId: ids.space, userId: ids.otherUser, role: 'viewer' }, ctx),
    );
    expect(result.code).toBe('FORBIDDEN');
  });
});

describe('spaces.addMembers', () => {
  it('skips users who are already members', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.users.listMembersBySpace!.mockResolvedValue([{ userId: ids.otherUser, role: 'editor' }]);

    const result = await invoke<{ added: number }>(
      spaceRouter.addMembers,
      { spaceId: ids.space, userIds: [ids.user, ids.otherUser], role: 'viewer' },
      ctx,
    );
    expect(result.added).toBe(1);
    expect(repos.users.grant).toHaveBeenCalledTimes(1);
  });
});

describe('spaces.setHome', () => {
  it('rejects a document from another space', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.spaces.findById!.mockResolvedValue(space());
    repos.content.findById!.mockResolvedValue({ id: 'x', spaceId: ids.otherSpace });

    const result = await failure(
      invoke(spaceRouter.setHome, { spaceId: ids.space, contentId: ids.otherUser }, ctx),
    );
    expect(result.key).toBe('content.notInSpace');
  });
});

describe('spaces.export', () => {
  it('is its own permission: an admin holds it, an editor does not', async () => {
    const admin = stubContext({ principal: principal({ spaces: { [ids.space]: 'admin' } }) });
    const exported = vi.spyOn(admin.spaces, 'export').mockResolvedValue({} as never);
    await invoke(spaceRouter.export, { spaceId: ids.space }, admin);
    // The request's environment, production here.
    expect(exported).toHaveBeenCalledWith(production(ids.space), undefined);

    const editor = stubContext({ principal: principal({ spaces: { [ids.space]: 'editor' } }) });
    for (const procedure of [
      spaceRouter.export,
      spaceRouter.inventory,
      spaceRouter.configInventory,
      spaceRouter.configSource,
    ]) {
      expect(await failure(invoke(procedure, { spaceId: ids.space }, editor))).toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });
});

describe('spaces.delete', () => {
  it('clears out the assets only that space held', async () => {
    const purgeOrphaned = vi.fn(async () => 2);
    const ctx = stubContext({ media: { purgeOrphaned } as never });
    const repos = mocks(ctx);
    repos.spaces.findById!.mockResolvedValue(space());
    repos.spaces.delete!.mockResolvedValue(undefined);
    expect(await invoke(spaceRouter.delete, { spaceId: ids.space }, ctx)).toEqual({ ok: true });
    expect(purgeOrphaned).toHaveBeenCalledOnce();
  });
});

describe('spaces.update', () => {
  it('passes only the fields sent, without filling in defaults', async () => {
    const ctx = stubContext();
    const repos = mocks(ctx);
    repos.spaces.findById!.mockResolvedValue(space());
    repos.spaces.update!.mockResolvedValue(space({ name: 'Renamed' }));

    await invoke(spaceRouter.update, { spaceId: ids.space, name: 'Renamed' }, ctx);
    const written = repos.spaces.update!.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written).toMatchObject({ name: 'Renamed' });
    expect(written).not.toHaveProperty('locales');
    expect(written).not.toHaveProperty('defaultLocale');
  });
});

describe('a space still importing', () => {
  it('answers reads and delete, and refuses writes with space.importing', async () => {
    const purgeOrphaned = vi.fn(async () => 0);
    const ctx = stubContext({ media: { purgeOrphaned } as never });
    const repos = mocks(ctx);
    repos.spaces.findById!.mockResolvedValue(space({ importStatus: 'failed' }));
    repos.spaces.delete!.mockResolvedValue(undefined);

    expect(await invoke(spaceRouter.get, { spaceId: ids.space }, ctx)).toMatchObject({
      importStatus: 'failed',
    });
    const refused = await failure(
      invoke(spaceRouter.update, { spaceId: ids.space, name: 'Renamed' }, ctx),
    );
    expect(refused).toMatchObject({ code: 'CONFLICT', key: 'space.importing' });
    expect(repos.spaces.update).not.toHaveBeenCalled();
    expect(await invoke(spaceRouter.delete, { spaceId: ids.space }, ctx)).toEqual({ ok: true });
  });

  it('is resumed by a superadmin only', async () => {
    const owner = stubContext();
    expect(
      await failure(invoke(spaceRouter.resumeImport, { spaceId: ids.space }, owner)),
    ).toMatchObject({ code: 'FORBIDDEN', key: 'auth.superadminRequired' });

    const admin = stubContext({ principal: superadmin() });
    const resumed = vi.spyOn(admin.spaces, 'resumeImport').mockResolvedValue({} as never);
    await invoke(spaceRouter.resumeImport, { spaceId: ids.space }, admin);
    expect(resumed).toHaveBeenCalledWith(ids.space);
  });
});
