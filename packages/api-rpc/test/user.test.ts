import {
  type ControlScope,
  DefaultControls,
  type FeatureKey,
  featureDenied,
  type ResolvedControls,
  type ResolvedFeature,
  resolveAll,
} from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it, type vi } from 'vitest';
import { userRouter } from '../src/routers/user.js';
import { failure, invoke, mocks, stubContext, superadmin } from './helpers/rpc.js';

const user = (overrides = {}) => ({
  id: ids.otherUser,
  name: 'Sam',
  email: 'sam@example.com',
  emailVerified: false,
  image: null,
  role: 'editor',
  banned: false,
  banReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

/** Controls resolved from stored values per scope label (`instance`, `space:<id>`). */
class StoredControls extends DefaultControls {
  constructor(private readonly stored: Record<string, Record<string, unknown>>) {
    super();
  }

  override async resolved(spaceId: string | null): Promise<ResolvedControls> {
    const scopes: ControlScope[] = [{ kind: 'instance' }];
    if (spaceId) scopes.push({ kind: 'space', id: spaceId });
    return resolveAll(
      scopes.map((scope) => ({
        scope,
        values: this.stored[scope.kind === 'instance' ? 'instance' : `space:${scope.id}`] ?? {},
      })),
    );
  }

  override async feature(spaceId: string | null, key: FeatureKey): Promise<ResolvedFeature> {
    const features = (await this.resolved(spaceId)).features as Record<string, ResolvedFeature>;
    return features[key] ?? { enabled: true, presentation: 'locked' };
  }

  override async assertFeature(spaceId: string | null, key: FeatureKey): Promise<void> {
    const feature = await this.feature(spaceId, key);
    if (!feature.enabled) throw featureDenied(key, feature);
  }
}

function withControls(
  ctx: ReturnType<typeof stubContext>,
  stored: Record<string, Record<string, unknown>>,
) {
  (ctx.manablox as unknown as { controls: StoredControls }).controls = new StoredControls(stored);
  // The scopes that store a value, as `control_settings` lists them.
  (
    ctx.repos.controlSettings as unknown as { storedScopes: ReturnType<typeof vi.fn> }
  ).storedScopes.mockResolvedValue(
    Object.keys(stored)
      .filter((label) => label !== 'instance')
      .map((label) => {
        const [kind, id] = label.split(':');
        return { kind, id };
      }),
  );
}

describe('users.me', () => {
  it('returns the switched-off features per visible space and the instance ones', async () => {
    const ctx = stubContext();
    mocks(ctx).users.findById.mockResolvedValue(user({ id: ids.user, role: 'editor' }));
    withControls(ctx, {
      instance: {
        'features.apiKeys': { enabled: false, message: 'Upgrade for keys', link: 'https://x.io' },
        'admin.links': { upgrade: 'https://x.io/upgrade' },
        'admin.banners': [
          { id: 'a', level: 'info', text: 'All', dismissible: true, audience: 'all' },
          { id: 'b', level: 'info', text: 'Root', dismissible: true, audience: 'superadmin' },
        ],
      },
      [`space:${ids.space}`]: {
        'features.databags': { enabled: false, presentation: 'hidden' },
        state: { status: 'readOnly', message: 'Over the limit' },
      },
    });

    const me = await invoke<{ controls: Record<string, unknown> }>(userRouter.me, undefined, ctx);
    const controls = me.controls as {
      features: Record<string, unknown>;
      links: Record<string, string>;
      banners: Array<{ id: string }>;
      state: { status: string };
      apiKeysDisable: boolean;
      spaces: Record<string, { features: Record<string, unknown>; state?: unknown }>;
    };
    expect(controls.features.apiKeys).toEqual({
      presentation: 'locked',
      message: 'Upgrade for keys',
      link: 'https://x.io',
    });
    expect(controls.features.databags).toBeUndefined();
    expect(controls.links).toEqual({ upgrade: 'https://x.io/upgrade' });
    expect(controls.banners.map((banner) => banner.id)).toEqual(['a']);
    expect(controls.state).toEqual({ status: 'active', message: null });
    expect(controls.apiKeysDisable).toBe(false);
    expect(Object.keys(controls.spaces)).toEqual([ids.space]);
    const space = controls.spaces[ids.space];
    expect(space?.features.databags).toEqual({ presentation: 'hidden' });
    expect(space?.features.apiKeys).toMatchObject({ presentation: 'locked' });
    expect(space?.state).toEqual({ status: 'readOnly', message: 'Over the limit' });
  });

  it('covers every space whose controls differ for a superadmin, and no other', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user({ id: ids.user, role: 'superadmin' }));
    repos.spaces.list.mockResolvedValue([
      { id: ids.space, groupId: null },
      { id: ids.otherSpace, groupId: 'group-1' },
      { id: 'plain-space', groupId: null },
    ]);
    withControls(ctx, {
      [`space:${ids.space}`]: { 'features.databags': { enabled: false } },
      'group:group-1': { 'features.menus': { enabled: false } },
    });
    const me = await invoke<{ controls: { spaces: Record<string, unknown> } }>(
      userRouter.me,
      undefined,
      ctx,
    );
    expect(Object.keys(me.controls.spaces).sort()).toEqual([ids.space, ids.otherSpace].sort());
  });

  it('sends no space entries while no space or group stores a value', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user({ id: ids.user, role: 'superadmin' }));
    repos.spaces.list.mockResolvedValue([{ id: ids.space, groupId: null }]);
    withControls(ctx, { instance: { 'features.databags': { enabled: false } } });
    const me = await invoke<{
      controls: { spaces: Record<string, unknown>; features: Record<string, unknown> };
    }>(userRouter.me, undefined, ctx);
    expect(me.controls.spaces).toEqual({});
    expect(me.controls.features.databags).toBeDefined();
  });

  it("carries the instance's usage flags to a space's editor through the space", async () => {
    const ctx = stubContext();
    mocks(ctx).users.findById.mockResolvedValue(user({ id: ids.user, role: 'editor' }));
    withControls(ctx, {});
    const notice = {
      level: 'blocked',
      resetsAt: '2026-10-01T00:00:00.000Z',
      scope: { kind: 'instance' },
      used: 10,
      max: 10,
    };
    (ctx.manablox.controls as unknown as { usageNotices: () => Promise<unknown> }).usageNotices =
      async () => ({ requests: notice });
    const me = await invoke<{
      controls: { usage: Record<string, unknown>; spaces: Record<string, { usage?: unknown }> };
    }>(userRouter.me, undefined, ctx);
    expect(me.controls.usage).toEqual({});
    expect(me.controls.spaces[ids.space]?.usage).toEqual({
      requests: { level: 'blocked', resetsAt: notice.resetsAt, scope: 'instance' },
    });
  });
});

describe('users.setupNeeded', () => {
  it('is public and true only while the instance has no account', async () => {
    const ctx = stubContext({ principal: null });
    const repos = mocks(ctx);
    repos.users.count.mockResolvedValue(0);
    expect(await invoke(userRouter.setupNeeded, undefined, ctx)).toEqual({ setupNeeded: true });
    repos.users.count.mockResolvedValue(3);
    expect(await invoke(userRouter.setupNeeded, undefined, ctx)).toEqual({ setupNeeded: false });
  });

  it('is false on a provisioned instance without accounts', async () => {
    const ctx = stubContext({ principal: null });
    const repos = mocks(ctx);
    repos.users.count.mockResolvedValue(0);
    repos.instanceMeta.get.mockResolvedValue({ at: '2026-09-25T00:00:00.000Z' });
    expect(await invoke(userRouter.setupNeeded, undefined, ctx)).toEqual({ setupNeeded: false });
  });
});

describe('users.list', () => {
  it('is superadmin-only', async () => {
    const result = await failure(invoke(userRouter.list, {}, stubContext()));
    expect(result.code).toBe('FORBIDDEN');
    expect(result.key).toBe('auth.superadminRequired');
  });

  it('strips the row down to a summary', async () => {
    const ctx = stubContext({ principal: superadmin() });
    mocks(ctx).users.page.mockResolvedValue({
      items: [user()],
      total: 1,
      limit: 25,
      offset: 0,
    });
    const page = await invoke<{ items: Record<string, unknown>[] }>(userRouter.list, {}, ctx);
    expect(page.items[0]).not.toHaveProperty('emailVerified');
    expect(page.items[0]).toMatchObject({ id: ids.otherUser, email: 'sam@example.com' });
  });
});

describe('users.create', () => {
  it('hashes the password and normalises the email', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.create.mockImplementation(async (data) => user({ email: data.email }));

    const created = await invoke<{ email: string }>(
      userRouter.create,
      { name: ' Sam ', email: 'Sam@Example.com', password: 'correct horse battery staple' },
      ctx,
    );

    expect(created.email).toBe('sam@example.com');
    const [data] = repos.users.create.mock.calls[0] as [Record<string, string>];
    expect(data.name).toBe('Sam');
    expect(data.role).toBe('editor');
    expect(data.passwordHash).toMatch(/^\$argon2id\$/);
    expect(data.passwordHash).not.toContain('correct horse');
  });

  it('refuses a short password before touching the database', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const result = await failure(
      invoke(userRouter.create, { name: 'Sam', email: 'sam@example.com', password: 'short' }, ctx),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(mocks(ctx).users.create).not.toHaveBeenCalled();
  });

  it('turns a duplicate email into a validation error', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const violation = Object.assign(new Error('Failed query: insert into "users"'), {
      cause: { code: '23505', message: 'duplicate key value violates "users_email_key"' },
    });
    mocks(ctx).users.create.mockRejectedValue(violation);
    const result = await failure(
      invoke(
        userRouter.create,
        { name: 'Sam', email: 'sam@example.com', password: 'correct horse battery staple' },
        ctx,
      ),
    );
    // The field-level key is in the validation error's details.
    expect(result.key).toBe('user.validation.failed');
    expect(result.details?.[0]).toMatchObject({ key: 'user.email.taken', path: ['email'] });
  });
});

describe('users.setRole', () => {
  it('keeps the last superadmin', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user({ id: ids.user, role: 'superadmin' }));
    repos.users.countByRole.mockResolvedValue(1);
    const result = await failure(
      invoke(userRouter.setRole, { userId: ids.user, role: 'editor' }, ctx),
    );
    expect(result.key).toBe('user.lastSuperadmin');
    expect(repos.users.setRole).not.toHaveBeenCalled();
  });

  it('demotes a superadmin when another remains', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user({ role: 'superadmin' }));
    repos.users.countByRole.mockResolvedValue(2);
    repos.users.setRole.mockResolvedValue(user());
    await invoke(userRouter.setRole, { userId: ids.otherUser, role: 'editor' }, ctx);
    expect(repos.users.setRole).toHaveBeenCalledWith(ids.otherUser, 'editor');
  });
});

describe('users.ban / users.delete', () => {
  it('will not act on the caller', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    for (const procedure of [userRouter.ban, userRouter.delete]) {
      const result = await failure(invoke(procedure, { userId: ids.user }, ctx));
      expect(result.key).toBe('user.self.protected');
    }
    expect(repos.users.setBanned).not.toHaveBeenCalled();
    expect(repos.users.delete).not.toHaveBeenCalled();
  });

  it('bans and signs the account out everywhere', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user());
    repos.users.setBanned.mockResolvedValue(user({ banned: true, banReason: 'left' }));
    const banned = await invoke<{ banned: boolean }>(
      userRouter.ban,
      { userId: ids.otherUser, reason: 'left' },
      ctx,
    );
    expect(banned.banned).toBe(true);
    expect(repos.users.setBanned).toHaveBeenCalledWith(ids.otherUser, true, 'left');
    expect(repos.users.revokeSessions).toHaveBeenCalledWith(ids.otherUser);
  });

  it('deletes an editor outright', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user());
    expect(await invoke(userRouter.delete, { userId: ids.otherUser }, ctx)).toEqual({ ok: true });
    expect(repos.users.delete).toHaveBeenCalledWith(ids.otherUser);
  });
});

describe('users.setPassword', () => {
  it('stores a hash and revokes every session', async () => {
    const ctx = stubContext({ principal: superadmin() });
    const repos = mocks(ctx);
    repos.users.findById.mockResolvedValue(user());
    await invoke(
      userRouter.setPassword,
      { userId: ids.otherUser, password: 'correct horse battery staple' },
      ctx,
    );
    const [, hash] = repos.users.setPasswordHash.mock.calls[0] as [string, string];
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(repos.users.revokeSessions).toHaveBeenCalledWith(ids.otherUser);
  });
});

describe('users.issueApiKey', () => {
  it('stores a permission restriction it has checked, and refuses one it cannot', async () => {
    const ctx = stubContext();
    const apiKeys = ctx.apiKeys as unknown as { issue: ReturnType<typeof vi.fn> };
    apiKeys.issue.mockResolvedValue({ id: 'k', name: 'site', key: 'mbx_x_y', prefix: 'x' });

    await invoke(
      userRouter.issueApiKey,
      {
        name: 'site',
        spaceIds: [ids.space],
        permissions: ['content:read', `content:write:${ids.type}`],
      },
      ctx,
    );
    expect(apiKeys.issue).toHaveBeenCalledWith(ids.user, 'site', {
      expiresAt: undefined,
      spaceIds: [ids.space],
      permissions: ['content:read', `content:write:${ids.type}`],
    });

    const refused = await failure(
      invoke(userRouter.issueApiKey, { name: 'site', permissions: ['content:read:nowhere'] }, ctx),
    );
    expect(refused.key).toBe('apiKey.validation.failed');
    expect(refused.details?.[0]?.path).toEqual(['permissions', 0]);
  });

  it('refuses while the apiKeys feature is off', async () => {
    const ctx = stubContext();
    withControls(ctx, { instance: { 'features.apiKeys': { enabled: false } } });
    const refused = await failure(invoke(userRouter.issueApiKey, { name: 'site' }, ctx));
    expect(refused.code).toBe('FORBIDDEN');
    expect(refused.key).toBe('control.feature');
    expect(
      (ctx.apiKeys as unknown as { issue: ReturnType<typeof vi.fn> }).issue,
    ).not.toHaveBeenCalled();
  });
});
