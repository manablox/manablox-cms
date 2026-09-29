import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { auditRouter } from '../src/routers/audit.js';
import { failure, invoke, principal, stubContext, superadmin } from './helpers/rpc.js';

const page = { items: [], total: 0, limit: 50, offset: 0 };

/** The service is a mock. */
function audit() {
  return {
    catalog: vi.fn(),
    list: vi.fn(),
    listInstance: vi.fn(),
    get: vi.fn(),
    forTarget: vi.fn(),
    verify: vi.fn(),
  };
}

describe('audit.list', () => {
  it('needs audit:read, which an owner holds and an editor lacks', async () => {
    const service = audit();
    service.list.mockResolvedValue(page);

    const owner = stubContext({ audit: service as never });
    expect(await invoke(auditRouter.list, { spaceId: ids.space }, owner)).toEqual(page);
    expect(service.list).toHaveBeenCalledWith(
      ids.space,
      {},
      { by: 'at', direction: 'desc' },
      { limit: 50, offset: 0 },
    );

    const editor = stubContext({
      audit: service as never,
      principal: principal({ spaces: { [ids.space]: 'editor' } }),
    });
    expect(await failure(invoke(auditRouter.list, { spaceId: ids.space }, editor))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('passes the filter, the sort and the page through, coercing dates', async () => {
    const service = audit();
    service.list.mockResolvedValue(page);
    const ctx = stubContext({ audit: service as never });
    await invoke(
      auditRouter.list,
      {
        spaceId: ids.space,
        filter: { actions: ['content.publish'], from: '2026-09-01T00:00:00.000Z', search: 'home' },
        sort: { by: 'actorLabel', direction: 'asc' },
        pagination: { limit: 10, offset: 20 },
      },
      ctx,
    );
    expect(service.list).toHaveBeenCalledWith(
      ids.space,
      { actions: ['content.publish'], from: new Date('2026-09-01T00:00:00.000Z'), search: 'home' },
      { by: 'actorLabel', direction: 'asc' },
      { limit: 10, offset: 20 },
    );
  });

  it('refuses an action the catalogue does not know before the service sees it', async () => {
    const service = audit();
    const ctx = stubContext({ audit: service as never });
    const result = await failure(
      invoke(auditRouter.list, { spaceId: ids.space, filter: { actions: ['content.hack'] } }, ctx),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(service.list).not.toHaveBeenCalled();
  });
});

describe('audit.listInstance / verify', () => {
  it("is a superadmin's, and pins the filter to instance-wide entries on request", async () => {
    const service = audit();
    service.listInstance.mockResolvedValue(page);
    service.verify.mockResolvedValue({ ok: true, checked: 3, brokenAt: null });

    const owner = stubContext({ audit: service as never });
    expect(await failure(invoke(auditRouter.listInstance, {}, owner))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await failure(invoke(auditRouter.verify, undefined, owner))).toMatchObject({
      code: 'FORBIDDEN',
    });

    const root = stubContext({ audit: service as never, principal: superadmin() });
    await invoke(auditRouter.listInstance, { instanceOnly: true }, root);
    expect(service.listInstance).toHaveBeenCalledWith(
      { spaceId: null },
      { by: 'at', direction: 'desc' },
      { limit: 50, offset: 0 },
    );
    await invoke(auditRouter.listInstance, {}, root);
    expect(service.listInstance).toHaveBeenLastCalledWith(
      {},
      { by: 'at', direction: 'desc' },
      { limit: 50, offset: 0 },
    );
    expect(await invoke(auditRouter.verify, undefined, root)).toEqual({
      ok: true,
      checked: 3,
      brokenAt: null,
    });
  });
});

describe('audit.get / forTarget', () => {
  it('scopes both to the space named in the input', async () => {
    const service = audit();
    service.get.mockResolvedValue({ id: ids.entry });
    service.forTarget.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    const ctx = stubContext({ audit: service as never });

    await invoke(auditRouter.get, { spaceId: ids.space, id: ids.entry }, ctx);
    expect(service.get).toHaveBeenCalledWith(ids.space, ids.entry);

    await invoke(
      auditRouter.forTarget,
      { spaceId: ids.space, targetKind: 'content', targetId: 'c1' },
      ctx,
    );
    expect(service.forTarget).toHaveBeenCalledWith(ids.space, 'content', 'c1', {
      limit: 50,
      offset: 0,
    });
  });
});
