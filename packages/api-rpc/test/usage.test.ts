import { DefaultControls, type UsageMetric, type UsageNotice, usagePeriod } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { usageRouter } from '../src/routers/usage.js';
import { userRouter } from '../src/routers/user.js';
import { failure, invoke, mocks, principal, stubContext, superadmin } from './helpers/rpc.js';

/** A context whose repositories hold one limit and some usage in `ids.space`. */
function withUsage(ctx: ReturnType<typeof stubContext>) {
  const period = usagePeriod(new Date()).label;
  const repos = ctx.repos as unknown as Record<string, Record<string, unknown>>;
  repos.controlSettings = {
    ...repos.controlSettings,
    listAll: vi.fn(async () => [
      {
        scopeKind: 'space',
        scopeId: ids.space,
        key: 'usage.apiRequests',
        value: { max: 100, mode: 'hard' },
      },
    ]),
  };
  repos.usageCounters = {
    ...repos.usageCounters,
    listSpaces: vi.fn(async () => [
      { spaceId: ids.space, metric: 'apiRequests', value: 90 },
      { spaceId: ids.otherSpace, metric: 'uploads', value: 3 },
    ]),
    listForScope: vi.fn(async () => [{ metric: 'bandwidthBytes', value: 2048 }]),
  };
  repos.usageExternal = { totals: vi.fn(async () => []) };
  mocks(ctx).spaces.list.mockResolvedValue([
    { id: ids.space, name: 'Blog', groupId: null },
    { id: ids.otherSpace, name: 'Shop', groupId: null },
  ]);
  return period;
}

describe('usage.space', () => {
  it('answers the space meters to its owner', async () => {
    const ctx = stubContext();
    const period = withUsage(ctx);
    const overview = await invoke<{
      period: string;
      scopes: Array<{ kind: string; name: string | null; metrics: unknown[] }>;
    }>(usageRouter.space, { spaceId: ids.space }, ctx);
    expect(overview.period).toBe(period);
    expect(overview.scopes.map((scope) => [scope.kind, scope.name])).toEqual([['space', 'Blog']]);
    expect(overview.scopes[0]?.metrics).toContainEqual({
      metric: 'apiRequests',
      used: 90,
      limit: { max: 100, mode: 'hard', thresholds: [80, 100] },
      level: 'warn',
    });
  });

  it('refuses members who may not change the space settings', async () => {
    const ctx = stubContext({ principal: principal({ spaces: { [ids.space]: 'editor' } }) });
    withUsage(ctx);
    expect(await failure(invoke(usageRouter.space, { spaceId: ids.space }, ctx))).toMatchObject({
      code: 'FORBIDDEN',
      key: 'auth.forbidden',
    });
    const outsider = stubContext();
    withUsage(outsider);
    expect(
      await failure(invoke(usageRouter.space, { spaceId: ids.otherSpace }, outsider)),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('usage.instance', () => {
  it('answers the instance and every space to a superadmin only', async () => {
    const ctx = stubContext({ principal: superadmin() });
    withUsage(ctx);
    const overview = await invoke<{
      scopes: Array<{ kind: string; name: string | null; metrics: Array<{ metric: string }> }>;
    }>(usageRouter.instance, undefined, ctx);
    expect(overview.scopes.map((scope) => [scope.kind, scope.name])).toEqual([
      ['instance', null],
      ['unattributed', null],
      ['space', 'Blog'],
      ['space', 'Shop'],
    ]);
    expect(overview.scopes[1]?.metrics).toEqual([
      { metric: 'apiRequests', used: 0, limit: null, level: null },
      { metric: 'bandwidthBytes', used: 2048, limit: null, level: null },
    ]);
    const owner = stubContext();
    withUsage(owner);
    expect(await failure(invoke(usageRouter.instance, undefined, owner))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

/** Every space and the instance have `mails` blocked at the instance. */
class BlockedControls extends DefaultControls {
  override async usageNotices(): Promise<Partial<Record<UsageMetric, UsageNotice>>> {
    return {
      mails: {
        scope: { kind: 'instance' },
        level: 'blocked',
        used: 5,
        max: 5,
        resetsAt: '2026-10-01T00:00:00.000Z',
      },
    };
  }
}

describe('users.me usage flags', () => {
  const me = async (ctx: ReturnType<typeof stubContext>) => {
    (ctx.manablox as unknown as { controls: BlockedControls }).controls = new BlockedControls();
    mocks(ctx).users.findById.mockResolvedValue({
      id: ids.user,
      name: 'A',
      email: 'a@example.com',
      image: null,
      role: ctx.principal?.role ?? 'editor',
    });
    return invoke<{
      controls: {
        usage: Record<string, unknown>;
        spaces: Record<string, { usage?: Record<string, unknown> }>;
      };
    }>(userRouter.me, undefined, ctx);
  };
  const flag = { level: 'blocked', resetsAt: '2026-10-01T00:00:00.000Z', scope: 'instance' };

  it('go to those who see the usage page', async () => {
    const owner = await me(stubContext());
    expect(owner.controls.usage).toEqual({});
    expect(owner.controls.spaces[ids.space]?.usage).toEqual({ mails: flag });

    const editor = await me(
      stubContext({ principal: principal({ spaces: { [ids.space]: 'editor' } }) }),
    );
    expect(editor.controls.spaces[ids.space]?.usage).toBeUndefined();

    const ctx = stubContext({ principal: superadmin() });
    mocks(ctx).spaces.list.mockResolvedValue([{ id: ids.space }]);
    const root = await me(ctx);
    expect(root.controls.usage).toEqual({ mails: flag });
  });
});
