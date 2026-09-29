import { ids } from '@manablox/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { assetRouter } from '../src/routers/asset.js';
import { assetContext } from './helpers/contexts.js';
import { failure, invoke, principal } from './helpers/rpc.js';

const asset = (overrides = {}) => ({
  id: ids.asset,
  filename: 'hero.jpg',
  name: 'hero',
  mimeType: 'image/jpeg',
  size: 4,
  meta: {},
  ...overrides,
});

describe('assets.page / get', () => {
  it('decorates every row with its URL, and a thumbnail only for images', async () => {
    const { ctx, assets } = assetContext();
    assets.page.mockResolvedValue({
      items: [asset(), asset({ id: ids.otherAsset, mimeType: 'application/pdf' })],
      total: 2,
      limit: 40,
      offset: 0,
    });
    const page = await invoke<{ items: Array<{ url: string; thumbnailUrl: string | null }> }>(
      assetRouter.list,
      { spaceId: ids.space },
      ctx,
    );
    expect(page.items[0]).toMatchObject({
      url: `/media/${ids.asset}`,
      thumbnailUrl: `/media/${ids.asset}/thumb`,
    });
    expect(page.items[1]?.thumbnailUrl).toBeNull();
    expect(assets.page).toHaveBeenCalledWith({ spaceId: ids.space }, { limit: 40, offset: 0 });
  });

  it('forwards the search and type filter only when given', async () => {
    const { ctx, assets } = assetContext();
    assets.page.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 5 });
    await invoke(
      assetRouter.list,
      {
        spaceId: ids.space,
        search: 'hero',
        mimeType: 'image/',
        pagination: { limit: 10, offset: 5 },
      },
      ctx,
    );
    expect(assets.page).toHaveBeenCalledWith(
      { spaceId: ids.space, mimeType: 'image/', search: 'hero' },
      { limit: 10, offset: 5 },
    );
  });

  it('forwards the excluded mime prefixes, and drops an empty list', async () => {
    const { ctx, assets } = assetContext();
    assets.page.mockResolvedValue({ items: [], total: 0, limit: 40, offset: 0 });
    await invoke(assetRouter.list, { spaceId: ids.space, mimeTypeNot: ['image/'] }, ctx);
    expect(assets.page).toHaveBeenLastCalledWith(
      { spaceId: ids.space, mimeTypeNot: ['image/'] },
      { limit: 40, offset: 0 },
    );
    await invoke(assetRouter.list, { spaceId: ids.space, mimeTypeNot: [] }, ctx);
    expect(assets.page).toHaveBeenLastCalledWith({ spaceId: ids.space }, { limit: 40, offset: 0 });
  });

  it('forwards the tag filter, and hands each row the tags of this space', async () => {
    const { ctx, assets } = assetContext();
    const tag = { id: ids.tag, name: 'Sunset', slug: 'sunset' };
    (ctx.tags as unknown as { ofAssets: ReturnType<typeof vi.fn> }).ofAssets = vi.fn(
      async (assetIds: string[]) => new Map(assetIds.map((id) => [id, [tag]])),
    );
    assets.page.mockResolvedValue({ items: [asset()], total: 1, limit: 40, offset: 0 });

    const page = await invoke<{ items: Array<{ tags: (typeof tag)[] }> }>(
      assetRouter.list,
      { spaceId: ids.space, tagIds: [tag.id] },
      ctx,
    );
    expect(assets.page).toHaveBeenCalledWith(
      { spaceId: ids.space, tagIds: [tag.id] },
      { limit: 40, offset: 0 },
    );
    expect(page.items[0]?.tags).toEqual([tag]);
    expect(ctx.tags.ofAssets).toHaveBeenCalledWith([ids.asset], ids.space);
  });

  it('answers null for an asset that is not in the space', async () => {
    const { ctx, assets } = assetContext();
    assets.findById.mockResolvedValue(null);
    expect(await invoke(assetRouter.get, { spaceId: ids.space, id: ids.asset }, ctx)).toBeNull();
    expect(assets.findById).toHaveBeenCalledWith(ids.asset, ids.space);
    assets.findById.mockResolvedValue(asset());
    expect(await invoke(assetRouter.get, { spaceId: ids.space, id: ids.asset }, ctx)).toMatchObject(
      {
        id: ids.asset,
        url: `/media/${ids.asset}`,
        spaceIds: [ids.space],
      },
    );
  });

  it('needs asset:read, which a member of another space lacks', async () => {
    const { ctx } = assetContext({ principal: principal({ spaces: {} }) });
    expect(await failure(invoke(assetRouter.list, { spaceId: ids.space }, ctx))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('assets.update / setImageEdits / delete', () => {
  it('writes only the named fields, never the space, through the service that logs it', async () => {
    const { ctx, media } = assetContext();
    media.update.mockResolvedValue(asset({ alt: 'A hero' }));
    const result = await invoke<{ alt: string; url: string }>(
      assetRouter.update,
      { spaceId: ids.space, id: ids.asset, alt: 'A hero' },
      ctx,
    );
    expect(media.update).toHaveBeenCalledWith(ids.space, ids.asset, { alt: 'A hero' });
    expect(result).toMatchObject({ alt: 'A hero', url: `/media/${ids.asset}` });
  });

  it('states the whole edit: anything omitted is cleared', async () => {
    const { ctx, media } = assetContext();
    media.setImageEdits.mockResolvedValue(asset());
    const result = await invoke<{ thumbnailUrl: string }>(
      assetRouter.setImageEdits,
      { spaceId: ids.space, id: ids.asset, focalPoint: { x: 0.5, y: 0.25 } },
      ctx,
    );
    expect(media.setImageEdits).toHaveBeenCalledWith(ids.space, ids.asset, {
      crop: null,
      focalPoint: { x: 0.5, y: 0.25 },
      rotate: null,
      flipHorizontal: null,
      flipVertical: null,
      adjust: null,
      effect: null,
    });
    expect(result.thumbnailUrl).toBe(`/media/${ids.asset}/thumb`);
  });

  it('refuses a focal point outside the image', async () => {
    const { ctx, media } = assetContext();
    const result = await failure(
      invoke(
        assetRouter.setImageEdits,
        { spaceId: ids.space, id: ids.asset, focalPoint: { x: 2, y: 0 } },
        ctx,
      ),
    );
    expect(result.code).toBe('BAD_REQUEST');
    expect(media.setImageEdits).not.toHaveBeenCalled();
  });

  it('lets an editor delete and an author only upload', async () => {
    const { ctx, media } = assetContext({
      principal: principal({ spaces: { [ids.space]: 'author' } }),
    });
    media.delete.mockResolvedValue({ removed: 'asset' });
    expect(
      await failure(invoke(assetRouter.delete, { spaceId: ids.space, id: ids.asset }, ctx)),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const editor = { ...ctx, principal: principal({ spaces: { [ids.space]: 'editor' } }) };
    expect(await invoke(assetRouter.delete, { spaceId: ids.space, id: ids.asset }, editor)).toEqual(
      {
        ok: true,
        removed: 'asset',
      },
    );
    expect(media.delete).toHaveBeenCalledWith(ids.space, ids.asset);
  });

  it('says when a shared asset only left this space', async () => {
    const { ctx, media } = assetContext();
    media.delete.mockResolvedValue({ removed: 'space' });
    expect(await invoke(assetRouter.delete, { spaceId: ids.space, id: ids.asset }, ctx)).toEqual({
      ok: true,
      removed: 'space',
    });
  });
});

describe('assets.setSpaces', () => {
  const both = { [ids.space]: 'editor', [ids.otherSpace]: 'editor' };

  it('shares the asset into another space the caller may upload to', async () => {
    const { ctx, assets, media } = assetContext({ principal: principal({ spaces: both }) });
    assets.findById.mockResolvedValue(asset());
    media.spaceIdsOf
      .mockResolvedValueOnce(new Map([[ids.asset, [ids.space]]]))
      .mockResolvedValueOnce(new Map([[ids.asset, [ids.space, ids.otherSpace]]]));
    const result = await invoke<{ spaceIds: string[] }>(
      assetRouter.setSpaces,
      { spaceId: ids.space, id: ids.asset, spaceIds: [ids.space, ids.otherSpace] },
      ctx,
    );
    expect(media.setSpaces).toHaveBeenCalledWith(ids.space, ids.asset, [ids.space, ids.otherSpace]);
    expect(result.spaceIds).toEqual([ids.space, ids.otherSpace]);
  });

  it('refuses a space the caller cannot upload to, adding or removing', async () => {
    const viewerThere = { [ids.space]: 'editor', [ids.otherSpace]: 'viewer' };
    const { ctx, media } = assetContext({ principal: principal({ spaces: viewerThere }) });
    const adding = await failure(
      invoke(
        assetRouter.setSpaces,
        { spaceId: ids.space, id: ids.asset, spaceIds: [ids.space, ids.otherSpace] },
        ctx,
      ),
    );
    expect(adding).toMatchObject({ code: 'FORBIDDEN', key: 'asset.spaces.forbidden' });

    media.spaceIdsOf.mockResolvedValueOnce(new Map([[ids.asset, [ids.space, ids.otherSpace]]]));
    const removing = await failure(
      invoke(
        assetRouter.setSpaces,
        { spaceId: ids.space, id: ids.asset, spaceIds: [ids.space] },
        ctx,
      ),
    );
    expect(removing).toMatchObject({ code: 'FORBIDDEN' });
    expect(media.setSpaces).not.toHaveBeenCalled();
  });

  it('leaves alone a space the caller is not in, as long as it stays', async () => {
    const { ctx, assets, media } = assetContext({ principal: principal({ spaces: both }) });
    const elsewhere = ids.missing;
    assets.findById.mockResolvedValue(asset());
    media.spaceIdsOf.mockResolvedValue(new Map([[ids.asset, [ids.space, elsewhere]]]));
    await invoke(
      assetRouter.setSpaces,
      { spaceId: ids.space, id: ids.asset, spaceIds: [ids.space, elsewhere, ids.otherSpace] },
      ctx,
    );
    expect(media.setSpaces).toHaveBeenCalled();
  });

  it('needs at least one space', async () => {
    const { ctx } = assetContext();
    expect(
      await failure(
        invoke(assetRouter.setSpaces, { spaceId: ids.space, id: ids.asset, spaceIds: [] }, ctx),
      ),
    ).toMatchObject({ code: 'BAD_REQUEST' });
  });
});
