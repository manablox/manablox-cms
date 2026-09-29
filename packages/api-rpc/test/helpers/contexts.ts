import { DefaultControls, type FeatureKey, type ResolvedFeature } from '@manablox/core';
import { ids } from '@manablox/core/testing';
import { type Mock, vi } from 'vitest';
import type { RpcContext } from '../../src/context.js';
import { stubContext } from './rpc.js';

/** Media over a mocked `assets` repository. */
export function assetContext(overrides: Record<string, unknown> = {}): {
  ctx: RpcContext;
  assets: Record<'page' | 'findById' | 'update', Mock>;
  media: Record<
    'limits' | 'urlFor' | 'spaceIdsOf' | 'setSpaces' | 'setImageEdits' | 'update' | 'delete',
    Mock
  >;
} {
  const assets = { page: vi.fn(), findById: vi.fn(), update: vi.fn() };
  const urlFor = (row: { id: string }, preset?: string) =>
    `/media/${row.id}${preset ? `/${preset}` : ''}`;
  const media = {
    limits: vi.fn(),
    urlFor: vi.fn(urlFor),
    // A miniature `present()`.
    present: (row: { id: string; mimeType: string }) => ({
      ...row,
      url: urlFor(row),
      thumbnailUrl: row.mimeType.startsWith('image/') ? urlFor(row, 'thumb') : null,
    }),
    spaceIdsOf: vi.fn(
      async (assetIds: string[]) => new Map(assetIds.map((id) => [id, [ids.space]])),
    ),
    setSpaces: vi.fn(),
    setImageEdits: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    // Lookups read the mocked repository, as the real service does.
    list: (filter: unknown, page: unknown) => assets.page(filter, page),
    get: (spaceId: string, id: string) => assets.findById(id, spaceId),
    find: (id: string) => assets.findById(id),
  };
  const ctx = stubContext({ media: media as never, ...overrides });
  (ctx.repos as unknown as { assets: typeof assets }).assets = assets;
  return { ctx, assets, media };
}

type ApprovalMocks = Record<
  'state' | 'pending' | 'request' | 'withdraw' | 'approve' | 'reject',
  Mock
>;

function approvals(): ApprovalMocks {
  return {
    state: vi.fn(),
    pending: vi.fn(),
    request: vi.fn(),
    withdraw: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  };
}

/** `ids.type` is under review and create succeeds. */
export function approvalContext(over: Parameters<typeof stubContext>[0] = {}): {
  ctx: RpcContext;
  service: ApprovalMocks;
  content: { create: Mock };
} {
  const service = approvals();
  const content = {
    create: vi.fn(async (input: { typeId: string }) => ({
      id: ids.doc,
      spaceId: ids.space,
      typeId: input.typeId,
    })),
  };
  const ctx = stubContext({
    approvals: service as never,
    content: content as never,
    manablox: {
      contentTypes: {
        forSpace: () => [{ id: ids.type }, { id: ids.otherType }],
        get: (id: string) => ({ id, requiresApproval: id === ids.type }),
      },
      controls: new DefaultControls(),
    } as never,
    ...over,
  });
  return { ctx, service, content };
}

/** The tag every tag-service stub answers with. */
export const TAG = { id: ids.tag, name: 'Travel', slug: 'travel' };

/** Tags and assets stubbed; `TAG` answers every tag call. */
export function tagContext(overrides: Record<string, unknown> = {}) {
  const tags = {
    list: vi.fn(async () => [TAG]),
    listWithCounts: vi.fn(async () => [{ ...TAG, contentCount: 1, assetCount: 0 }]),
    ofContent: vi.fn(async () => new Map()),
    ofAssets: vi.fn(async () => new Map()),
    setForContent: vi.fn(async () => [TAG]),
    setForAsset: vi.fn(async () => [TAG]),
    create: vi.fn(async () => TAG),
    rename: vi.fn(async () => TAG),
    merge: vi.fn(async () => TAG),
    delete: vi.fn(async () => undefined),
  };
  const assets = { get: vi.fn(async () => ({ id: ids.asset })) };
  const ctx = stubContext({ tags: tags as never, media: assets as never, ...overrides });
  return { ctx, tags, assets };
}

/** The message and link a switched-off feature carries in these tests. */
export const LOCKED = { message: 'Upgrade to unlock', link: 'https://example.com/upgrade' };

/** Catalogue defaults with `off` switched off in `spaceId`, or everywhere without one. */
export function controlsWith(off: FeatureKey[], spaceId: string | null = null): DefaultControls {
  return new (class extends DefaultControls {
    override async feature(space: string | null, key: FeatureKey): Promise<ResolvedFeature> {
      const base = await super.feature(space, key);
      if (!off.includes(key) || (spaceId !== null && space !== spaceId)) return base;
      return { ...base, enabled: false, ...LOCKED };
    }
  })();
}
