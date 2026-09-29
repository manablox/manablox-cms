import { ids } from '@manablox/core/testing';
import { describe, expect, it } from 'vitest';
import { contentRouter } from '../src/routers/content.js';
import { approvalContext } from './helpers/contexts.js';
import { failure, invoke, principal, production } from './helpers/rpc.js';

const draft = { spaceId: ids.space, typeId: ids.type, title: 'Draft', fields: {} };

describe('content.create and review', () => {
  it('opens a request by itself when an author creates a document of a reviewed type', async () => {
    const { ctx, service } = approvalContext({
      principal: principal({ spaces: { [ids.space]: 'author' } }),
    });
    await invoke(contentRouter.create, draft, ctx);
    expect(service.request).toHaveBeenCalledWith(production(ids.space), ids.doc, {
      userId: ids.user,
      roles: ['editor', 'author'],
    });
  });

  it('opens nothing for someone who can publish, for a type without review, or a translation', async () => {
    const owner = approvalContext();
    await invoke(contentRouter.create, draft, owner.ctx);
    expect(owner.service.request).not.toHaveBeenCalled();

    const author = approvalContext({ principal: principal({ spaces: { [ids.space]: 'author' } }) });
    await invoke(contentRouter.create, { ...draft, typeId: ids.otherType }, author.ctx);
    await invoke(contentRouter.create, { ...draft, localizationId: ids.localization }, author.ctx);
    expect(author.service.request).not.toHaveBeenCalled();
  });
});

describe('the review procedures', () => {
  it('asking needs content:write; deciding needs content:publish', async () => {
    const author = approvalContext({ principal: principal({ spaces: { [ids.space]: 'author' } }) });
    author.service.request.mockResolvedValue({ id: 'a1' });
    await invoke(
      contentRouter.requestApproval,
      { spaceId: ids.space, id: ids.doc, note: ' Hi ' },
      author.ctx,
    );
    expect(author.service.request).toHaveBeenCalledWith(
      production(ids.space),
      ids.doc,
      { userId: ids.user, roles: ['editor', 'author'] },
      'Hi',
    );
    expect(
      await failure(invoke(contentRouter.approve, { spaceId: ids.space, id: ids.doc }, author.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await failure(invoke(contentRouter.reject, { spaceId: ids.space, id: ids.doc }, author.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await failure(invoke(contentRouter.pendingApprovals, { spaceId: ids.space }, author.ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });

    const viewer = approvalContext({ principal: principal({ spaces: { [ids.space]: 'viewer' } }) });
    expect(
      await failure(
        invoke(contentRouter.requestApproval, { spaceId: ids.space, id: ids.doc }, viewer.ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an editor approves, rejects with an empty note as no note, and sees the whole queue', async () => {
    const { ctx, service } = approvalContext({
      principal: principal({ spaces: { [ids.space]: 'editor' } }),
    });
    service.approve.mockResolvedValue({ approval: {}, content: {} });
    service.reject.mockResolvedValue({});
    service.pending.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });

    await invoke(contentRouter.approve, { spaceId: ids.space, id: ids.doc, note: '' }, ctx);
    expect(service.approve).toHaveBeenCalledWith(
      production(ids.space),
      ids.doc,
      { userId: ids.user, roles: ['editor', 'editor'] },
      null,
    );
    await invoke(contentRouter.reject, { spaceId: ids.space, id: ids.doc, note: 'Fix it' }, ctx);
    expect(service.reject).toHaveBeenLastCalledWith(
      production(ids.space),
      ids.doc,
      expect.anything(),
      'Fix it',
    );

    await invoke(contentRouter.pendingApprovals, { spaceId: ids.space }, ctx);
    // An editor publishes every type, so the queue is not narrowed.
    expect(service.pending).toHaveBeenCalledWith(production(ids.space), null, {
      limit: 10,
      offset: 0,
    });
  });

  it('narrows the queue to the types a custom role may publish', async () => {
    const { ctx, service } = approvalContext({
      principal: principal({
        spaces: { [ids.space]: 'reviewer' },
        permissions: { [ids.space]: ['content:read', `content:publish:${ids.type}`] },
      }),
    });
    service.pending.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
    await invoke(contentRouter.pendingApprovals, { spaceId: ids.space }, ctx);
    expect(service.pending).toHaveBeenCalledWith(production(ids.space), [ids.type], {
      limit: 10,
      offset: 0,
    });
  });

  it('reads the state of a document anyone may read', async () => {
    const { ctx, service } = approvalContext({
      principal: principal({ spaces: { [ids.space]: 'viewer' } }),
    });
    service.state.mockResolvedValue({ required: true, pending: null, latest: null, history: [] });
    expect(await invoke(contentRouter.approval, { spaceId: ids.space, id: ids.doc }, ctx)).toEqual({
      required: true,
      pending: null,
      latest: null,
      history: [],
    });
  });
});
