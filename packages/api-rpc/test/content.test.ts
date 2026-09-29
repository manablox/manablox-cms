import { ManabloxError } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { contentRouter } from '../src/routers/content.js';
import {
  failure,
  invoke,
  mocks,
  PRODUCTION_ID,
  principal,
  production,
  stubContext,
} from './helpers/rpc.js';

function content() {
  return {
    list: vi.fn(),
    tree: vi.fn(),
    treeChildren: vi.fn(),
    treeSearch: vi.fn(),
    get: vi.fn(),
    initFields: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    schedule: vi.fn(),
    move: vi.fn(),
    translations: vi.fn(),
    createTranslation: vi.fn(),
    restore: vi.fn(),
  };
}

const row = (overrides = {}) => ({
  id: ids.doc,
  spaceId: ids.space,
  typeId: ids.type,
  locale: 'en',
  title: 'Hello',
  slug: 'hello',
  fields: {},
  ...overrides,
});

const page = { items: [], total: 0, limit: 25, offset: 0 };

/** A role narrowed to one type. */
const narrowed = () =>
  principal({
    spaces: { [ids.space]: 'blogger' },
    permissions: {
      [ids.space]: [
        'space:read',
        'contentType:read',
        `content:read:${ids.type}`,
        `content:write:${ids.type}`,
      ],
    },
  });

describe('content.list', () => {
  it('reads the space out of the filter and passes the actor along', async () => {
    const service = content();
    service.list.mockResolvedValue(page);
    const ctx = stubContext({ content: service as never });
    await invoke(contentRouter.list, { filter: { spaceId: ids.space } }, ctx);
    expect(service.list).toHaveBeenCalledWith(
      { spaceId: ids.space, environmentId: PRODUCTION_ID },
      { limit: 25, offset: 0 },
      [],
      {
        actor: { userId: ids.user, roles: ['editor', 'owner'] },
      },
    );
  });

  it('narrows a type-scoped role to the types it may read, and answers empty when none remain', async () => {
    const service = content();
    service.list.mockResolvedValue(page);
    const ctx = stubContext({ content: service as never, principal: narrowed() });

    await invoke(contentRouter.list, { filter: { spaceId: ids.space } }, ctx);
    expect(service.list.mock.calls[0]?.[0]).toEqual({
      environmentId: PRODUCTION_ID,
      spaceId: ids.space,
      typeIds: [ids.type],
    });

    const empty = await invoke(
      contentRouter.list,
      { filter: { spaceId: ids.space, typeIds: [ids.otherType] } },
      ctx,
    );
    expect(empty).toEqual(page);
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it('refuses a filter operator and a sort key it does not know', async () => {
    const ctx = stubContext({ content: content() as never });
    const bad = await failure(
      invoke(
        contentRouter.list,
        { filter: { spaceId: ids.space, fields: [{ name: 'x', op: 'regex' }] } },
        ctx,
      ),
    );
    expect(bad.code).toBe('BAD_REQUEST');
    const badSort = await failure(
      invoke(contentRouter.list, { filter: { spaceId: ids.space }, sort: [{ by: 'colour' }] }, ctx),
    );
    expect(badSort.code).toBe('BAD_REQUEST');
  });
});

describe('content.tree / treeChildren / translations', () => {
  it('passes the actor, and no type narrowing for a broad role', async () => {
    const service = content();
    service.tree.mockResolvedValue([]);
    service.treeChildren.mockResolvedValue(page);
    const ctx = stubContext({ content: service as never });
    const actor = { userId: ids.user, roles: ['editor', 'owner'] };

    await invoke(contentRouter.tree, { spaceId: ids.space }, ctx);
    expect(service.tree).toHaveBeenCalledWith(production(ids.space), 'en', null, {
      actor,
      typeIds: null,
    });
    await invoke(contentRouter.treeChildren, { spaceId: ids.space }, ctx);
    expect(service.treeChildren).toHaveBeenCalledWith(production(ids.space), 'en', null, {
      limit: 50,
      offset: 0,
      actor,
      typeIds: null,
    });
  });

  it('narrows a type-scoped role to the types it may read', async () => {
    const service = content();
    service.tree.mockResolvedValue([]);
    service.treeChildren.mockResolvedValue(page);
    const ctx = stubContext({ content: service as never, principal: narrowed() });

    await invoke(contentRouter.tree, { spaceId: ids.space }, ctx);
    expect(service.tree.mock.calls[0]?.[3]).toMatchObject({ typeIds: [ids.type] });
    await invoke(contentRouter.treeChildren, { spaceId: ids.space }, ctx);
    expect(service.treeChildren.mock.calls[0]?.[3]).toMatchObject({ typeIds: [ids.type] });
  });

  it('searches the tree with the readable types and the wanted match types', async () => {
    const service = content();
    service.treeSearch.mockResolvedValue({ nodes: [], total: 0 });
    const ctx = stubContext({ content: service as never, principal: narrowed() });

    await invoke(
      contentRouter.treeSearch,
      { spaceId: ids.space, search: 'news', typeIds: [ids.type] },
      ctx,
    );
    expect(service.treeSearch).toHaveBeenCalledWith(production(ids.space), 'en', 'news', {
      limit: 50,
      actor: expect.anything(),
      typeIds: [ids.type],
      matchTypeIds: [ids.type],
    });

    const empty = await failure(
      invoke(contentRouter.treeSearch, { spaceId: ids.space, search: '' }, ctx),
    );
    expect(empty.code).toBe('BAD_REQUEST');
  });

  it('refuses the translations of a type the role cannot read', async () => {
    const service = content();
    const ctx = stubContext({ content: service as never, principal: narrowed() });
    mocks(ctx).content.findById.mockResolvedValue(row({ typeId: ids.otherType }));

    const refused = await failure(
      invoke(contentRouter.translations, { spaceId: ids.space, id: ids.doc }, ctx),
    );
    expect(refused.code).toBe('FORBIDDEN');
    expect(service.translations).not.toHaveBeenCalled();
  });
});

describe('content.get / delete / publish', () => {
  it('reads the document without a second lookup for a broad role', async () => {
    const service = content();
    service.get.mockResolvedValue(row());
    const ctx = stubContext({ content: service as never });
    expect(await invoke(contentRouter.get, { spaceId: ids.space, id: ids.doc }, ctx)).toEqual({
      ...row(),
      tags: [],
    });
    expect(mocks(ctx).content.findById).not.toHaveBeenCalled();
  });

  it("checks the document's type for a narrowed role, and hides one it may not read", async () => {
    const service = content();
    service.get.mockResolvedValue(row());
    const ctx = stubContext({ content: service as never, principal: narrowed() });
    const repos = mocks(ctx);

    repos.content.findById.mockResolvedValue(row());
    expect(await invoke(contentRouter.get, { spaceId: ids.space, id: ids.doc }, ctx)).toEqual({
      ...row(),
      tags: [],
    });

    repos.content.findById.mockResolvedValue(row({ typeId: ids.otherType }));
    expect(
      await failure(invoke(contentRouter.get, { spaceId: ids.space, id: ids.doc }, ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });

    repos.content.findById.mockResolvedValue(null);
    expect(
      await failure(invoke(contentRouter.get, { spaceId: ids.space, id: ids.doc }, ctx)),
    ).toMatchObject({ code: 'NOT_FOUND', key: 'content.notFound' });
  });

  it('keeps publishing from an author, who may write but never publish', async () => {
    const service = content();
    service.publish.mockResolvedValue(row());
    const ctx = stubContext({
      content: service as never,
      principal: principal({ spaces: { [ids.space]: 'author' } }),
    });
    expect(
      await failure(invoke(contentRouter.publish, { spaceId: ids.space, id: ids.doc }, ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await invoke(contentRouter.delete, { spaceId: ids.space, id: ids.doc }, ctx)).toEqual({
      ok: true,
    });
  });
});

describe('content.schedule', () => {
  it('passes both ends through, an ISO string included', async () => {
    const service = content();
    service.schedule.mockResolvedValue(row());
    const ctx = stubContext({ content: service as never });

    await invoke(
      contentRouter.schedule,
      {
        spaceId: ids.space,
        id: ids.doc,
        publishAt: '2026-10-01T09:00:00.000Z',
        unpublishAt: null,
      },
      ctx,
    );

    expect(service.schedule).toHaveBeenCalledWith(production(ids.space), ids.doc, {
      publishAt: new Date('2026-10-01T09:00:00.000Z'),
      unpublishAt: null,
    });
  });

  it('leaves out an end the call did not mention, so one can move without the other', async () => {
    const service = content();
    service.schedule.mockResolvedValue(row());
    const ctx = stubContext({ content: service as never });

    await invoke(
      contentRouter.schedule,
      { spaceId: ids.space, id: ids.doc, unpublishAt: null },
      ctx,
    );

    expect(service.schedule).toHaveBeenCalledWith(production(ids.space), ids.doc, {
      unpublishAt: null,
    });
  });

  it('is publishing, so an author may not schedule either', async () => {
    const service = content();
    const ctx = stubContext({
      content: service as never,
      principal: principal({ spaces: { [ids.space]: 'author' } }),
    });
    expect(
      await failure(
        invoke(contentRouter.schedule, { spaceId: ids.space, id: ids.doc, publishAt: null }, ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(service.schedule).not.toHaveBeenCalled();
  });
});

describe('content.create / update', () => {
  it('defaults the locale and fields and checks the type for a narrowed role', async () => {
    const service = content();
    service.create.mockResolvedValue(row());
    const ctx = stubContext({ content: service as never, principal: narrowed() });
    await invoke(
      contentRouter.create,
      { spaceId: ids.space, typeId: ids.type, title: 'Hello' },
      ctx,
    );
    expect(service.create).toHaveBeenCalledWith(
      {
        spaceId: ids.space,
        environmentId: PRODUCTION_ID,
        typeId: ids.type,
        title: 'Hello',
        locale: 'en',
        fields: {},
      },
      { userId: ids.user, roles: ['editor', 'blogger'] },
    );
    expect(
      await failure(
        invoke(
          contentRouter.create,
          { spaceId: ids.space, typeId: ids.otherType, title: 'X' },
          ctx,
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maps a validation error to BAD_REQUEST with every detail', async () => {
    const service = content();
    service.update.mockRejectedValue(
      ManabloxError.validation(
        [
          { key: 'content.slug.duplicate', path: ['slug'] },
          { key: 'field.required', path: ['fields', 'body'] },
        ],
        'content.validation.failed',
      ),
    );
    const ctx = stubContext({ content: service as never });
    const result = await failure(
      invoke(
        contentRouter.update,
        { spaceId: ids.space, id: ids.doc, typeId: ids.type, title: 'Hello' },
        ctx,
      ),
    );
    expect(result).toMatchObject({ code: 'BAD_REQUEST', key: 'content.validation.failed' });
    expect(result.details?.map((d) => d.path)).toEqual([['slug'], ['fields', 'body']]);
  });

  it('refuses an empty title before the service', async () => {
    const service = content();
    const ctx = stubContext({ content: service as never });
    const result = await failure(
      invoke(contentRouter.create, { spaceId: ids.space, typeId: ids.type, title: '' }, ctx),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(service.create).not.toHaveBeenCalled();
  });
});

describe('content.move / translations / blank', () => {
  it('hands the destination through and maps a cross-space parent to BAD_REQUEST', async () => {
    const service = content();
    service.move.mockResolvedValueOnce(row());
    service.move.mockRejectedValueOnce(
      ManabloxError.badRequest('content.parent.notInSpace', { parentId: ids.doc }),
    );
    const ctx = stubContext({ content: service as never });
    await invoke(
      contentRouter.move,
      { spaceId: ids.space, id: ids.doc, parentId: null, position: 2 },
      ctx,
    );
    expect(service.move).toHaveBeenCalledWith(production(ids.space), ids.doc, null, 2);
    expect(
      await failure(
        invoke(
          contentRouter.move,
          { spaceId: ids.space, id: ids.doc, parentId: ids.doc, position: 0 },
          ctx,
        ),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST', key: 'content.parent.notInSpace' });
  });

  it('starts a translation in the named locale', async () => {
    const service = content();
    service.createTranslation.mockResolvedValue(row({ locale: 'de' }));
    const ctx = stubContext({ content: service as never });
    await invoke(
      contentRouter.createTranslation,
      { spaceId: ids.space, id: ids.doc, locale: 'de' },
      ctx,
    );
    expect(service.createTranslation).toHaveBeenCalledWith(production(ids.space), ids.doc, 'de', {
      userId: ids.user,
      roles: ['editor', 'owner'],
    });
  });

  it("opens a blank document with the type's defaults", async () => {
    const service = content();
    service.initFields.mockResolvedValue({ body: '' });
    const ctx = stubContext({
      content: service as never,
      contentTypes: { get: () => ({ id: ids.type }) } as never,
    });
    expect(
      await invoke(contentRouter.blank, { spaceId: ids.space, typeId: ids.type }, ctx),
    ).toEqual({
      fields: { body: '' },
    });
  });
});
