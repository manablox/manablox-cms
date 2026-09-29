import { ids } from '@manablox/core/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RpcContext } from '../src/context.js';
import { instanceRouter } from '../src/routers/instance.js';
import { invitationRouter } from '../src/routers/invitation.js';
import { preferenceRouter } from '../src/routers/preference.js';
import { userRouter } from '../src/routers/user.js';
import { failure, invoke, mocks, principal, stubContext, superadmin } from './helpers/rpc.js';

const row = (overrides = {}) => ({
  id: ids.user,
  name: 'Owner',
  email: 'owner@example.com',
  emailVerified: true,
  twoFactorEnabled: false,
  image: null,
  role: 'editor',
  banned: false,
  banReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

/** Calls a procedure under its router path, as the transport does. */
const at = <T>(path: string, procedure: unknown, input: unknown, context: RpcContext) =>
  call(procedure as never, input as never, { context, path: path.split('.') }) as Promise<T>;

describe('while two-factor enrolment is pending', () => {
  const pending = () => principal({ spaces: {}, twoFactorPending: true });

  it('answers only the account read and preferences', async () => {
    const ctx = stubContext({ principal: pending() });
    const prefs = { get: vi.fn(async () => null), set: vi.fn() };
    (ctx.repos as unknown as { userPreferences: typeof prefs }).userPreferences = prefs;
    mocks(ctx).users.findById.mockResolvedValue(row());
    mocks(ctx).users.listMembershipsWithSpaces.mockResolvedValue([]);

    const me = await at<{ twoFactor: { pending: boolean } }>(
      'users.me',
      userRouter.me,
      undefined,
      ctx,
    );
    expect(me.twoFactor.pending).toBe(true);
    await at('preferences.get', preferenceRouter.get, { key: 'banners.dismissed' }, ctx);

    expect(await failure(at('users.apiKeys', userRouter.apiKeys, undefined, ctx))).toMatchObject({
      code: 'FORBIDDEN',
      key: 'auth.twoFactor.enrolmentRequired',
    });
    expect(
      await failure(at('users.updateProfile', userRouter.updateProfile, { name: 'New' }, ctx)),
    ).toMatchObject({ key: 'auth.twoFactor.enrolmentRequired' });
  });
});

describe('users.updateProfile', () => {
  it('asks for confirmation of a new email and keeps the old one meanwhile', async () => {
    const ctx = stubContext();
    mocks(ctx).users.findById.mockResolvedValue(row());
    mocks(ctx).users.listMembershipsWithSpaces.mockResolvedValue([]);
    const requestChange = vi.fn(async () => ({ status: 'sent', email: 'new@example.com' }));
    (ctx.emailVerification as unknown as { requestChange: typeof requestChange }).requestChange =
      requestChange;

    const result = await invoke<{ email: string; emailChange: unknown }>(
      userRouter.updateProfile,
      { email: 'New@Example.com' },
      ctx,
    );
    expect(requestChange).toHaveBeenCalledWith(ids.user, 'new@example.com', expect.any(Headers));
    expect(result).toMatchObject({
      email: 'owner@example.com',
      emailChange: { status: 'sent', email: 'new@example.com' },
    });
    expect(mocks(ctx).users.update).not.toHaveBeenCalled();
  });

  it('leaves an unchanged email alone', async () => {
    const ctx = stubContext();
    mocks(ctx).users.findById.mockResolvedValue(row());
    mocks(ctx).users.listMembershipsWithSpaces.mockResolvedValue([]);
    const result = await invoke<{ emailChange: unknown }>(
      userRouter.updateProfile,
      { email: 'owner@example.com' },
      ctx,
    );
    expect(result.emailChange).toBeNull();
    expect(ctx.emailVerification.requestChange).not.toHaveBeenCalled();
  });
});

describe('preferences', () => {
  it('stores only known keys in their shape, for the caller', async () => {
    const ctx = stubContext();
    const prefs = { get: vi.fn(async () => ['a']), set: vi.fn(async () => undefined) };
    (ctx.repos as unknown as { userPreferences: typeof prefs }).userPreferences = prefs;

    expect(await invoke(preferenceRouter.get, { key: 'banners.dismissed' }, ctx)).toEqual({
      key: 'banners.dismissed',
      value: ['a'],
    });
    await invoke(preferenceRouter.set, { key: 'banners.dismissed', value: ['a', 'b'] }, ctx);
    expect(prefs.set).toHaveBeenCalledWith(ids.user, 'banners.dismissed', ['a', 'b']);

    expect(
      await failure(invoke(preferenceRouter.set, { key: 'other', value: 1 }, ctx)),
    ).toMatchObject({ code: 'BAD_REQUEST' });
    expect(
      await failure(invoke(preferenceRouter.set, { key: 'banners.dismissed', value: [1] }, ctx)),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('instance settings', () => {
  it('are for superadmins', async () => {
    expect(await failure(invoke(instanceRouter.settings, undefined, stubContext()))).toMatchObject({
      key: 'auth.superadminRequired',
    });
    const ctx = stubContext({ principal: superadmin() });
    await invoke(instanceRouter.updateSettings, { twoFactorPolicy: 'admins' }, ctx);
    expect(ctx.twoFactor.setPolicy).toHaveBeenCalledWith('admins');
  });
});

describe('invitations.list', () => {
  it('needs a superadmin, or `user:read` in the asked space', async () => {
    const list = vi.fn(async () => []);
    const viewer = stubContext({
      principal: principal({ spaces: { [ids.space]: 'viewer' } }),
      invitations: { list } as never,
    });
    expect(await failure(invoke(invitationRouter.list, {}, viewer))).toMatchObject({
      key: 'auth.superadminRequired',
    });
    expect(
      await failure(invoke(invitationRouter.list, { spaceId: ids.otherSpace }, viewer)),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const admin = stubContext({ invitations: { list } as never });
    await invoke(invitationRouter.list, { spaceId: ids.space }, admin);
    expect(list).toHaveBeenCalledWith({ spaceId: ids.space });
  });
});
