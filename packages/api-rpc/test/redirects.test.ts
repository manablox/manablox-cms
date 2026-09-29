import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { router } from '../src/index.js';
import { redirectRouter } from '../src/routers/redirect.js';
import { failure, invoke, principal, production, stubContext } from './helpers/rpc.js';

function redirectContext(role = 'owner') {
  const redirects = {
    list: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
    get: vi.fn(),
    create: vi.fn(async () => ({ id: ids.doc })),
    update: vi.fn(),
    delete: vi.fn(async () => undefined),
  };
  const ctx = stubContext({
    principal: principal({ spaces: { [ids.space]: role } }),
    redirects: redirects as never,
  });
  return { ctx, redirects };
}

describe('redirects', () => {
  it('is registered as redirects', () => {
    expect(router.redirects).toBe(redirectRouter);
  });

  it('lists with default pagination and creates as the caller', async () => {
    const { ctx, redirects } = redirectContext('editor');
    await invoke(redirectRouter.list, { spaceId: ids.space, source: 'auto' }, ctx);
    expect(redirects.list).toHaveBeenCalledWith(
      production(ids.space),
      { search: undefined, source: 'auto' },
      { limit: 50, offset: 0 },
    );
    await invoke(
      redirectRouter.create,
      { spaceId: ids.space, fromPath: '/a', toPath: '/b', status: 302 },
      ctx,
    );
    expect(redirects.create).toHaveBeenCalledWith(
      production(ids.space),
      { fromPath: '/a', toPath: '/b', status: 302 },
      ids.user,
    );
    expect(
      await failure(
        invoke(redirectRouter.create, { spaceId: ids.space, fromPath: '/a', status: 307 }, ctx),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('lets a viewer read but not write, and an author neither', async () => {
    const author = redirectContext('author');
    expect(
      await failure(invoke(redirectRouter.list, { spaceId: ids.space }, author.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const { ctx, redirects } = redirectContext('viewer');
    await invoke(redirectRouter.list, { spaceId: ids.space }, ctx);
    expect(redirects.list).toHaveBeenCalled();
    expect(
      await failure(invoke(redirectRouter.delete, { spaceId: ids.space, id: ids.doc }, ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(redirects.delete).not.toHaveBeenCalled();
  });
});
