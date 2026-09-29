import { ids } from '@manablox/core/testing';
import type { EnvironmentLifecycleService } from '@manablox/services';
import { describe, expect, it, vi } from 'vitest';
import { scoped } from '../src/base.js';
import { environmentRouter } from '../src/routers/environment.js';
import { failure, invoke, principal, stubContext } from './helpers/rpc.js';

const ROW = {
  id: ids.otherSpace,
  spaceId: ids.space,
  machineName: 'staging',
  name: 'Staging',
  kind: 'staging' as const,
  createdFrom: null,
  createdMode: 'config' as const,
  createdAt: new Date('2026-09-26T10:00:00Z'),
  updatedAt: new Date('2026-09-26T10:00:00Z'),
};

/** A context with a stub lifecycle service recording its calls, as a member with `role`. */
function context(role = 'owner') {
  const service = {
    list: vi.fn(async () => [ROW]),
    create: vi.fn(async () => ({ environment: ROW, copied: { contentTypes: 1 } })),
    diff: vi.fn(async () => ({ confirmRequired: false })),
    promote: vi.fn(async () => ({ status: 'applied' })),
    delete: vi.fn(async () => undefined),
  };
  const ctx = stubContext({
    principal: principal({ spaces: { [ids.space]: role } }),
    environmentLifecycle: service as unknown as EnvironmentLifecycleService,
    environments: {
      forRequest: vi.fn(async (spaceId: string, machineName: string | null) => ({
        spaceId,
        environmentId: ids.otherSpace,
        machineName: machineName ?? 'production',
        production: !machineName || machineName === 'production',
      })),
      list: vi.fn(async () => [ROW]),
    } as never,
  });
  return { ctx, service };
}

describe('environments', () => {
  it('lists for every member', async () => {
    const { ctx } = context('viewer');
    const listed = await invoke<Array<{ machineName: string }>>(
      environmentRouter.list,
      { spaceId: ids.space },
      ctx,
    );
    expect(listed.map((row) => row.machineName)).toEqual(['staging']);
  });

  it('creates, diffs, promotes and deletes for owners and admins', async () => {
    for (const role of ['owner', 'admin']) {
      const { ctx, service } = context(role);
      await invoke(
        environmentRouter.create,
        { spaceId: ids.space, machineName: 'staging', name: 'Staging', mode: 'full' },
        ctx,
      );
      expect(service.create).toHaveBeenCalledWith(ids.space, {
        from: undefined,
        machineName: 'staging',
        name: 'Staging',
        mode: 'full',
      });
      await invoke(environmentRouter.diff, { spaceId: ids.space, environment: 'staging' }, ctx);
      expect(service.diff).toHaveBeenCalledWith(ids.space, 'staging', 'config');
      await invoke(
        environmentRouter.promote,
        { spaceId: ids.space, environment: 'staging', mode: 'full', confirm: true },
        ctx,
      );
      expect(service.promote).toHaveBeenCalledWith(ids.space, 'staging', 'full', {
        confirm: true,
      });
      await invoke(environmentRouter.delete, { spaceId: ids.space, environment: 'staging' }, ctx);
      expect(service.delete).toHaveBeenCalledWith(ids.space, 'staging');
    }
  });

  it('refuses editors', async () => {
    const { ctx, service } = context('editor');
    const input = { spaceId: ids.space, environment: 'staging' };
    expect(await failure(invoke(environmentRouter.promote, input, ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await failure(invoke(environmentRouter.delete, input, ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(service.promote).not.toHaveBeenCalled();
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('lets a custom role with the permission manage them', async () => {
    const { ctx, service } = context('keeper');
    ctx.principal = principal({
      spaces: { [ids.space]: 'keeper' },
      permissions: { [ids.space]: ['space:read', 'environment:manage'] },
    });
    await invoke(environmentRouter.delete, { spaceId: ids.space, environment: 'staging' }, ctx);
    expect(service.delete).toHaveBeenCalled();
  });

  it("checks a write against the request's environment, for a running promote", async () => {
    const { ctx } = context('owner');
    const writable = vi.spyOn(ctx.manablox.controls, 'assertWritable');
    const write = scoped('menu:write').handler(() => 'ok');
    await invoke(write, { spaceId: ids.space, environment: 'staging' }, ctx);
    expect(writable).toHaveBeenLastCalledWith(
      expect.objectContaining({ spaceId: ids.space, machineName: 'staging', production: false }),
    );
  });
});
