import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { router } from '../src/index.js';
import { apiHostRouter } from '../src/routers/api-host.js';
import { failure, invoke, principal, production, stubContext } from './helpers/rpc.js';

function hostContext(role = 'owner') {
  const apiHosts = {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: ids.doc })),
    verify: vi.fn(async () => ({ id: ids.doc })),
    delete: vi.fn(async () => undefined),
  };
  const ctx = stubContext({
    principal: principal({ spaces: { [ids.space]: role } }),
    apiHosts: apiHosts as never,
  });
  return { ctx, apiHosts };
}

describe('apiHosts', () => {
  it('is registered under its plan name', () => {
    expect(router.apiHosts).toBe(apiHostRouter);
  });

  it('lists for members and writes with space:write', async () => {
    const editor = hostContext('editor');
    await invoke(apiHostRouter.list, { spaceId: ids.space }, editor.ctx);
    expect(editor.apiHosts.list).toHaveBeenCalledWith(production(ids.space));
    expect(
      await failure(
        invoke(apiHostRouter.create, { spaceId: ids.space, hostname: 'api.a.test' }, editor.ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const owner = hostContext('owner');
    await invoke(apiHostRouter.create, { spaceId: ids.space, hostname: 'api.a.test' }, owner.ctx);
    expect(owner.apiHosts.create).toHaveBeenCalledWith(production(ids.space), 'api.a.test');
    await invoke(apiHostRouter.verify, { spaceId: ids.space, id: ids.doc }, owner.ctx);
    expect(owner.apiHosts.verify).toHaveBeenCalledWith(production(ids.space), ids.doc);
    await invoke(apiHostRouter.delete, { spaceId: ids.space, id: ids.doc }, owner.ctx);
    expect(owner.apiHosts.delete).toHaveBeenCalledWith(production(ids.space), ids.doc);
  });
});
