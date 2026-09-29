import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { tagRouter } from '../src/routers/tag.js';
import { TAG, tagContext } from './helpers/contexts.js';
import { failure, invoke, principal, production } from './helpers/rpc.js';

/** A role narrowed to one content type. */
const narrowed = () =>
  principal({
    spaces: { [ids.space]: 'blogger' },
    permissions: {
      [ids.space]: ['space:read', `content:read:${ids.type}`, `content:write:${ids.type}`],
    },
  });

describe('tags.list', () => {
  it('reads the space vocabulary, with the search term only when given', async () => {
    const { ctx, tags } = tagContext();
    expect(await invoke(tagRouter.list, { spaceId: ids.space }, ctx)).toEqual([TAG]);
    expect(tags.list).toHaveBeenCalledWith(ids.space, undefined);

    await invoke(tagRouter.list, { spaceId: ids.space, search: 'tra' }, ctx);
    expect(tags.list).toHaveBeenLastCalledWith(ids.space, 'tra');
  });
});

describe('tags.setForContent', () => {
  it('tags the document localization group, not the single translation', async () => {
    const { ctx, tags } = tagContext();
    (ctx.repos as unknown as { content: { findById: ReturnType<typeof vi.fn> } }).content.findById =
      vi.fn(async () => ({
        id: ids.doc,
        spaceId: ids.space,
        typeId: ids.type,
        localizationId: 'g1',
      }));

    expect(
      await invoke(
        tagRouter.setForContent,
        { spaceId: ids.space, contentId: ids.doc, tags: ['Travel'] },
        ctx,
      ),
    ).toEqual([TAG]);
    expect(tags.setForContent).toHaveBeenCalledWith(
      production(ids.space),
      'g1',
      ['Travel'],
      expect.anything(),
    );
  });

  it('refuses a document of a type the role may not write', async () => {
    const { ctx, tags } = tagContext({ principal: narrowed() });
    (ctx.repos as unknown as { content: { findById: ReturnType<typeof vi.fn> } }).content.findById =
      vi.fn(async () => ({
        id: ids.doc,
        spaceId: ids.space,
        typeId: ids.otherType,
        localizationId: 'g1',
      }));

    expect(
      await failure(
        invoke(tagRouter.setForContent, { spaceId: ids.space, contentId: ids.doc, tags: [] }, ctx),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(tags.setForContent).not.toHaveBeenCalled();
  });

  it('leaves another space alone', async () => {
    const { ctx, tags } = tagContext();
    (ctx.repos as unknown as { content: { findById: ReturnType<typeof vi.fn> } }).content.findById =
      vi.fn(async () => ({
        id: ids.doc,
        spaceId: 'elsewhere',
        typeId: ids.type,
        localizationId: 'g1',
      }));

    expect(
      await invoke(
        tagRouter.setForContent,
        { spaceId: ids.space, contentId: ids.doc, tags: ['X'] },
        ctx,
      ),
    ).toEqual([]);
    expect(tags.setForContent).not.toHaveBeenCalled();
  });
});

describe('tags.setForAsset', () => {
  it('needs the asset in the space', async () => {
    const { ctx, tags, assets } = tagContext();
    expect(
      await invoke(
        tagRouter.setForAsset,
        { spaceId: ids.space, assetId: ids.asset, tags: ['Travel'] },
        ctx,
      ),
    ).toEqual([TAG]);
    expect(tags.setForAsset).toHaveBeenCalledWith(
      ids.space,
      ids.asset,
      ['Travel'],
      expect.anything(),
    );

    assets.get.mockResolvedValue(null as never);
    expect(
      await invoke(
        tagRouter.setForAsset,
        { spaceId: ids.space, assetId: ids.asset, tags: [] },
        ctx,
      ),
    ).toEqual([]);
    expect(tags.setForAsset).toHaveBeenCalledTimes(1);
  });
});

describe('managing the vocabulary', () => {
  it('takes the content write permission, which an asset-only role lacks', async () => {
    const { ctx } = tagContext({
      principal: principal({
        spaces: { [ids.space]: 'uploader' },
        permissions: { [ids.space]: ['space:read', 'asset:read', 'asset:write'] },
      }),
    });
    expect(
      await failure(invoke(tagRouter.rename, { spaceId: ids.space, id: TAG.id, name: 'X' }, ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    // Reading the vocabulary only needs to be in the space.
    expect(await invoke(tagRouter.list, { spaceId: ids.space }, ctx)).toEqual([TAG]);
  });
});
