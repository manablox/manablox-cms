import { ManabloxError } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { menuRouter } from '../src/routers/menu.js';
import {
  failure,
  invoke,
  PRODUCTION_ID,
  principal,
  production,
  stubContext,
} from './helpers/rpc.js';

const menu = (overrides = {}) => ({
  id: ids.menu,
  spaceId: ids.space,
  name: 'Main',
  machineName: 'main',
  description: null,
  ...overrides,
});

/** The service is a mock. */
function menus() {
  return {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    setItems: vi.fn(),
    usedIn: vi.fn(),
    placements: vi.fn(),
    setPlacements: vi.fn(),
  };
}

describe('menus.list / get', () => {
  it('passes the space and the locale through to the service', async () => {
    const service = menus();
    service.list.mockResolvedValue([menu()]);
    service.get.mockResolvedValue({ menu: menu(), items: [] });
    const ctx = stubContext({ menus: service as never });

    expect(await invoke(menuRouter.list, { spaceId: ids.space }, ctx)).toEqual([menu()]);
    await invoke(menuRouter.get, { spaceId: ids.space, id: ids.menu, locale: 'de' }, ctx);
    expect(service.get).toHaveBeenCalledWith(production(ids.space), ids.menu, 'de');
  });

  it('needs menu:read, which a member of another space lacks', async () => {
    const ctx = stubContext({
      menus: menus() as never,
      principal: principal({ spaces: {} }),
    });
    expect(await failure(invoke(menuRouter.list, { spaceId: ids.space }, ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('is closed without a principal', async () => {
    const ctx = stubContext({ menus: menus() as never, principal: null });
    expect(await failure(invoke(menuRouter.list, { spaceId: ids.space }, ctx))).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('menus.create / update / delete', () => {
  it('needs menu:write, which a viewer lacks and an editor holds', async () => {
    const service = menus();
    service.create.mockResolvedValue(menu());
    const input = { spaceId: ids.space, name: 'Main', machineName: 'main' };

    const viewer = stubContext({
      menus: service as never,
      principal: principal({ spaces: { [ids.space]: 'viewer' } }),
    });
    expect(await failure(invoke(menuRouter.create, input, viewer))).toMatchObject({
      code: 'FORBIDDEN',
    });

    const editor = stubContext({
      menus: service as never,
      principal: principal({ spaces: { [ids.space]: 'editor' } }),
    });
    expect(await invoke(menuRouter.create, input, editor)).toEqual(menu());
    expect(service.create).toHaveBeenCalledWith({ ...input, environmentId: PRODUCTION_ID });
  });

  it('rejects a machine name that is not technical before the service sees it', async () => {
    const service = menus();
    const ctx = stubContext({ menus: service as never });
    const result = await failure(
      invoke(menuRouter.create, { spaceId: ids.space, name: 'Main', machineName: 'Main Nav' }, ctx),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('maps a service validation error to BAD_REQUEST with its details', async () => {
    const service = menus();
    service.create.mockRejectedValue(
      ManabloxError.validation(
        [{ key: 'menu.machineName.taken', path: ['machineName'], params: { machineName: 'main' } }],
        'menu.validation.failed',
      ),
    );
    const ctx = stubContext({ menus: service as never });
    const result = await failure(
      invoke(menuRouter.create, { spaceId: ids.space, name: 'Main', machineName: 'main' }, ctx),
    );
    expect(result).toMatchObject({
      code: 'BAD_REQUEST',
      key: 'menu.validation.failed',
      details: [{ key: 'menu.machineName.taken', path: ['machineName'] }],
    });
  });

  it('splits the update into the space, the id and the data', async () => {
    const service = menus();
    service.update.mockResolvedValue(menu({ name: 'Primary' }));
    const ctx = stubContext({ menus: service as never });
    await invoke(menuRouter.update, { spaceId: ids.space, id: ids.menu, name: 'Primary' }, ctx);
    expect(service.update).toHaveBeenCalledWith(production(ids.space), ids.menu, {
      name: 'Primary',
    });
  });

  it('maps a missing menu to NOT_FOUND and answers a delete with ok', async () => {
    const service = menus();
    service.delete.mockRejectedValueOnce(ManabloxError.notFound('menu.notFound', { id: ids.menu }));
    service.delete.mockResolvedValueOnce(undefined);
    const ctx = stubContext({ menus: service as never });
    expect(
      await failure(invoke(menuRouter.delete, { spaceId: ids.space, id: ids.menu }, ctx)),
    ).toMatchObject({ code: 'NOT_FOUND', key: 'menu.notFound' });
    expect(await invoke(menuRouter.delete, { spaceId: ids.space, id: ids.menu }, ctx)).toEqual({
      ok: true,
    });
  });
});

describe('menus.setItems', () => {
  it('accepts a nested tree of documents and links and hands it over whole', async () => {
    const service = menus();
    service.setItems.mockResolvedValue([]);
    const ctx = stubContext({ menus: service as never });
    const items = [
      {
        localizationId: ids.localization,
        children: [{ url: 'https://blog.example', label: 'Blog', children: [] }],
      },
    ];
    await invoke(menuRouter.setItems, { spaceId: ids.space, id: ids.menu, items }, ctx);
    expect(service.setItems).toHaveBeenCalledWith(production(ids.space), ids.menu, items);
  });

  it('refuses an entry whose localization id is not a uuid', async () => {
    const service = menus();
    const ctx = stubContext({ menus: service as never });
    const result = await failure(
      invoke(
        menuRouter.setItems,
        { spaceId: ids.space, id: ids.menu, items: [{ localizationId: 'nope' }] },
        ctx,
      ),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(service.setItems).not.toHaveBeenCalled();
  });

  it("surfaces the service's positional error paths untouched", async () => {
    const service = menus();
    service.setItems.mockRejectedValue(
      ManabloxError.validation(
        [{ key: 'menu.item.linkNeedsLabel', path: ['items', 0, 'children', 1] }],
        'menu.validation.failed',
      ),
    );
    const ctx = stubContext({ menus: service as never });
    const result = await failure(
      invoke(menuRouter.setItems, { spaceId: ids.space, id: ids.menu, items: [] }, ctx),
    );
    expect(result.details?.[0]?.path).toEqual(['items', 0, 'children', 1]);
  });
});

describe('menus.usedIn', () => {
  it('asks for the menus referencing a localization', async () => {
    const service = menus();
    service.usedIn.mockResolvedValue([menu()]);
    const ctx = stubContext({ menus: service as never });
    const result = await invoke(
      menuRouter.usedIn,
      { spaceId: ids.space, localizationId: ids.localization },
      ctx,
    );
    expect(result).toEqual([menu()]);
    expect(service.usedIn).toHaveBeenCalledWith(production(ids.space), ids.localization);
  });
});

describe('menus.placements', () => {
  it('reads every menu with the spot the document holds in it', async () => {
    const service = menus();
    service.placements.mockResolvedValue([{ menu: menu(), entries: [], placement: null }]);
    const ctx = stubContext({ menus: service as never });
    await invoke(
      menuRouter.placements,
      { spaceId: ids.space, localizationId: ids.localization, locale: 'de' },
      ctx,
    );
    expect(service.placements).toHaveBeenCalledWith(production(ids.space), ids.localization, 'de');
  });

  it('defaults a placement to the top level, first', async () => {
    const service = menus();
    service.setPlacements.mockResolvedValue([menu()]);
    const ctx = stubContext({ menus: service as never });
    await invoke(
      menuRouter.setPlacements,
      { spaceId: ids.space, localizationId: ids.localization, placements: [{ menuId: ids.menu }] },
      ctx,
    );
    expect(service.setPlacements).toHaveBeenCalledWith(production(ids.space), ids.localization, [
      { menuId: ids.menu, parentId: null, index: 0 },
    ]);
  });

  it('needs menu:write to place a document', async () => {
    const ctx = stubContext({
      menus: menus() as never,
      principal: principal({ spaces: { [ids.space]: 'viewer' } }),
    });
    const result = await failure(
      invoke(
        menuRouter.setPlacements,
        { spaceId: ids.space, localizationId: ids.localization, placements: [] },
        ctx,
      ),
    );
    expect(result).toMatchObject({ code: 'FORBIDDEN' });
  });
});
