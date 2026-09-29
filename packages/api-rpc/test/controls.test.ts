import {
  DefaultControls,
  type ResolvedState,
  type Scope,
  scopeSpaceId,
  stateRefusal,
} from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import type { RpcContext } from '../src/context.js';
import { assetRouter } from '../src/routers/asset.js';
import { contentRouter } from '../src/routers/content.js';
import { roleRouter } from '../src/routers/role.js';
import { spaceRouter } from '../src/routers/space.js';
import { userRouter } from '../src/routers/user.js';
import { approvalContext, assetContext, controlsWith, LOCKED } from './helpers/contexts.js';
import { failure, invoke, mocks, principal, stubContext, superadmin } from './helpers/rpc.js';

type Off = Parameters<typeof controlsWith>[0];

function switchOff(ctx: RpcContext, off: Off, spaceId: string | null = null): void {
  (ctx.manablox as unknown as { controls: unknown }).controls = controlsWith(off, spaceId);
}

const refused = (feature: string) => ({
  code: 'FORBIDDEN',
  key: 'control.feature',
  details: [expect.objectContaining({ params: { feature, ...LOCKED } })],
});

describe('approvals off', () => {
  it('opens no request by itself when an author creates a reviewed document', async () => {
    const { ctx, service } = approvalContext({
      principal: principal({ spaces: { [ids.space]: 'author' } }),
    });
    switchOff(ctx, ['approvals']);
    await invoke(
      contentRouter.create,
      { spaceId: ids.space, typeId: ids.type, title: 'Draft', fields: {} },
      ctx,
    );
    expect(service.request).not.toHaveBeenCalled();
  });
});

describe('scheduledPublishing off', () => {
  it('refuses a new asset window and still clears one', async () => {
    const { ctx, assets, media } = assetContext();
    switchOff(ctx, ['scheduledPublishing'], ids.space);
    const at = new Date(Date.now() + 86_400_000).toISOString();

    expect(
      await failure(
        invoke(assetRouter.schedule, { spaceId: ids.space, id: ids.asset, publishAt: at }, ctx),
      ),
    ).toMatchObject(refused('scheduledPublishing'));
    expect(media.update).not.toHaveBeenCalled();

    const schedule = { schedule: async () => ({ id: ids.asset, mimeType: 'image/png' }) };
    Object.assign(ctx.media, schedule);
    assets.findById.mockResolvedValue({ id: ids.asset });
    await invoke(
      assetRouter.schedule,
      { spaceId: ids.space, id: ids.asset, publishAt: null, unpublishAt: null },
      ctx,
    );
  });

  it('leaves other spaces alone', async () => {
    const { ctx } = assetContext({
      principal: principal({ spaces: { [ids.otherSpace]: 'owner' } }),
    });
    switchOff(ctx, ['scheduledPublishing'], ids.space);
    Object.assign(ctx.media, {
      schedule: async () => ({ id: ids.asset, mimeType: 'image/png' }),
    });
    const at = new Date(Date.now() + 86_400_000).toISOString();
    await invoke(
      assetRouter.schedule,
      { spaceId: ids.otherSpace, id: ids.asset, publishAt: at },
      ctx,
    );
  });
});

describe('spaceCreate off', () => {
  it('refuses spaces.create and spaces.import at the instance', async () => {
    const ctx = stubContext({ principal: superadmin() });
    switchOff(ctx, ['spaceCreate']);
    expect(
      await failure(
        invoke(
          spaceRouter.create,
          { name: 'Site', machineName: 'site', url: 'http://localhost:3002' },
          ctx,
        ),
      ),
    ).toMatchObject(refused('spaceCreate'));
    expect(mocks(ctx).spaces.create).not.toHaveBeenCalled();

    expect(await failure(invoke(spaceRouter.import, { payload: {} }, ctx))).toMatchObject(
      refused('spaceCreate'),
    );
  });
});

describe('customRoles off', () => {
  it('refuses role writes and keeps reads', async () => {
    const ctx = stubContext();
    switchOff(ctx, ['customRoles']);
    const input = {
      spaceId: ids.space,
      name: 'Translator',
      machineName: 'translator',
      permissions: [],
    };
    expect(await failure(invoke(roleRouter.create, input, ctx))).toMatchObject(
      refused('customRoles'),
    );
    expect(await failure(invoke(roleRouter.update, { ...input, id: ids.role }, ctx))).toMatchObject(
      refused('customRoles'),
    );
    expect(
      await failure(invoke(roleRouter.delete, { spaceId: ids.space, id: ids.role }, ctx)),
    ).toMatchObject(refused('customRoles'));
    expect(mocks(ctx).roles.create).not.toHaveBeenCalled();

    mocks(ctx).roles.listBySpace.mockResolvedValue([]);
    expect(await invoke(roleRouter.list, { spaceId: ids.space }, ctx)).toHaveLength(5);
  });
});

/** Controls whose state is `state` at the instance, or only in `spaceId`. */
function withState(ctx: RpcContext, state: ResolvedState, spaceId: string | null = null): void {
  (ctx.manablox as unknown as { controls: unknown }).controls = new (class extends DefaultControls {
    override async resolved(space: string | null) {
      const resolved = await super.resolved(space);
      return spaceId === null || space === spaceId ? { ...resolved, state } : resolved;
    }
    override async assertWritable(scope: Scope | null) {
      const space = scope === null ? null : scopeSpaceId(scope);
      const refusal = stateRefusal((await this.resolved(space)).state);
      if (refusal) throw refusal;
    }
  })();
}

const roleInput = { spaceId: ids.space, name: 'T', machineName: 't', permissions: [] };

describe('a read-only state', () => {
  it('refuses scoped writes in the space and keeps reads and other spaces', async () => {
    const ctx = stubContext({
      principal: principal({ spaces: { [ids.space]: 'owner', [ids.otherSpace]: 'owner' } }),
    });
    withState(ctx, { status: 'readOnly', scope: { kind: 'space', id: ids.space } }, ids.space);
    expect(await failure(invoke(roleRouter.create, roleInput, ctx))).toMatchObject({
      code: 'LOCKED',
      key: 'control.readOnly',
    });
    expect(mocks(ctx).roles.create).not.toHaveBeenCalled();
    mocks(ctx).roles.listBySpace.mockResolvedValue([]);
    expect(await invoke(roleRouter.list, { spaceId: ids.space }, ctx)).toHaveLength(5);
    mocks(ctx).roles.create.mockResolvedValue({ id: ids.role });
    await invoke(roleRouter.create, { ...roleInput, spaceId: ids.otherSpace }, ctx);
    expect(mocks(ctx).roles.create).toHaveBeenCalled();
  });

  it('refuses superadmin writes at the instance', async () => {
    const ctx = stubContext({ principal: superadmin() });
    withState(ctx, { status: 'readOnly', scope: { kind: 'instance' }, message: 'Invoice due' });
    const refusal = await failure(
      invoke(spaceRouter.create, { name: 'S', machineName: 's', url: 'http://localhost:1' }, ctx),
    );
    expect(refusal).toMatchObject({ code: 'LOCKED', key: 'control.readOnly' });
    expect(mocks(ctx).spaces.create).not.toHaveBeenCalled();
  });
});

describe('a suspended instance', () => {
  it('refuses every procedure but users.me and users.setupNeeded', async () => {
    const ctx = stubContext();
    withState(ctx, { status: 'suspended', scope: { kind: 'instance' }, message: 'Suspended' });
    mocks(ctx).roles.listBySpace.mockResolvedValue([]);
    expect(await failure(invoke(roleRouter.list, { spaceId: ids.space }, ctx))).toMatchObject({
      code: 'LOCKED',
      key: 'control.suspended',
    });
    await expect(
      call(userRouter.me, undefined, { context: ctx, path: ['users', 'me'] }),
    ).resolves.toBeNull();
    await expect(
      call(userRouter.setupNeeded, undefined, { context: ctx, path: ['users', 'setupNeeded'] }),
    ).resolves.toBeDefined();
  });
});
