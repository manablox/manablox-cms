import { ids } from '@manablox/core/testing';
import type { SnapshotService } from '@manablox/services';
import { describe, expect, it, vi } from 'vitest';
import { snapshotRouter } from '../src/routers/snapshot.js';
import { failure, invoke, mocks, principal, stubContext, superadmin } from './helpers/rpc.js';

const SNAPSHOT = '2026-09-25T10-15-00-000Z';

/** A context with a stub snapshot service recording its calls. */
function context(overrides: Parameters<typeof stubContext>[0] = {}) {
  const service = {
    supported: true,
    list: vi.fn(async () => [{ id: SNAPSHOT }]),
    create: vi.fn(async () => ({ id: SNAPSHOT })),
    restore: vi.fn(async () => ({ spaceId: ids.otherSpace })),
  };
  const ctx = stubContext({ snapshots: service as unknown as SnapshotService, ...overrides });
  mocks(ctx).spaces.findById.mockResolvedValue({ id: ids.space, machineName: 'site' });
  return { ctx, service };
}

const restoreInput = (confirm = 'site') => ({
  spaceId: ids.space,
  snapshot: SNAPSHOT,
  mode: 'replace' as const,
  confirm,
});

describe('snapshots', () => {
  it('lists with the interval and window that apply', async () => {
    const { ctx } = context();
    expect(await invoke(snapshotRouter.list, { spaceId: ids.space }, ctx)).toEqual({
      supported: true,
      interval: null,
      retentionDays: 7,
      items: [{ id: SNAPSHOT }],
    });
  });

  it('takes a manual snapshot as the caller', async () => {
    const { ctx, service } = context();
    await invoke(snapshotRouter.create, { spaceId: ids.space }, ctx);
    expect(service.create).toHaveBeenCalledWith(ids.space, {
      trigger: 'manual',
      actorId: ids.user,
    });
  });

  it('restores for an owner who typed the machine name', async () => {
    const { ctx, service } = context();
    await invoke(snapshotRouter.restore, restoreInput(), ctx);
    expect(service.restore).toHaveBeenCalledWith(ids.space, SNAPSHOT, {
      mode: 'replace',
      actorId: ids.user,
    });
  });

  it('refuses a restore without the machine name', async () => {
    const { ctx, service } = context();
    expect(await failure(invoke(snapshotRouter.restore, restoreInput('wrong'), ctx))).toMatchObject(
      { key: 'snapshot.confirmMismatch' },
    );
    expect(service.restore).not.toHaveBeenCalled();
  });

  it('lets only owners and superadmins restore', async () => {
    const admin = context({ principal: principal({ spaces: { [ids.space]: 'admin' } }) });
    expect(await failure(invoke(snapshotRouter.restore, restoreInput(), admin.ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const custom = context({
      principal: principal({
        spaces: { [ids.space]: 'keeper' },
        permissions: { [ids.space]: ['space:read', 'space:delete'] },
      }),
    });
    expect(await failure(invoke(snapshotRouter.restore, restoreInput(), custom.ctx))).toMatchObject(
      { key: 'snapshot.ownerOnly' },
    );
    const root = context({ principal: superadmin() });
    await invoke(snapshotRouter.restore, restoreInput(), root.ctx);
    expect(root.service.restore).toHaveBeenCalledOnce();
  });

  it('refuses without snapshot storage', async () => {
    const ctx = stubContext();
    expect(await failure(invoke(snapshotRouter.create, { spaceId: ids.space }, ctx))).toMatchObject(
      { key: 'snapshot.unsupported' },
    );
  });
});
