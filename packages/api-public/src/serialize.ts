import type {
  AssetCrop,
  BlockGridSettings,
  BlockLayout,
  FocalPoint,
  LinkValue,
} from '@manablox/core';
import type { ContentRow } from '@manablox/db';
import { buildContent } from './build.js';
import { type Collected, collectRow, loadTags, resolveInRounds } from './collect.js';
import type { PublicContext } from './context.js';

export { type AssetVariantSpec, serializeAsset, toPublicTags } from './asset.js';

/** A tag as delivered: the name shown, the slug to filter by. */
export interface PublicTag {
  name: string;
  slug: string;
}

export interface PublicAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  title: string | null;
  /** For rendering the original with CSS `object-position`; variants already honour it. */
  focalPoint: FocalPoint | null;
  /** Crop in the original's pixels; variants are cut to it. */
  crop: AssetCrop | null;
  /** Signed transform URLs by preset name; clients cannot sign them. */
  variants: Record<string, string>;
  /** The tags the space gives it. */
  tags: PublicTag[];
}

/** A `link` field as delivered: the stored value with its address resolved. */
export interface PublicLink extends LinkValue {
  href: string | null;
  /** The referenced document, when named in `?expand=` and found. */
  content?: unknown;
}

export interface PublicUser {
  id: string;
  name: string;
  image: string | null;
}

export interface PublicContent {
  id: string;
  type: string;
  title: string;
  slug: string;
  permalink: string | null;
  locale: string;
  parentId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  /** Plain map by field name, readable without schema knowledge. */
  fields: Record<string, unknown>;
  /** Tags of the document, shared by all its translations. */
  tags: PublicTag[];
}

export interface PublicBlock {
  blockId: string;
  type: string;
  fields: Record<string, unknown>;
  /** Present only on grid fields. */
  layout?: BlockLayout;
  /** Plugin data by the plugin's field, like a designed site's `design`. */
  [field: string]: unknown;
}

/** A `blocks` field as delivered; `grid` is `null` for a plain list. */
export interface PublicBlocks {
  grid: BlockGridSettings | null;
  blocks: PublicBlock[];
}

/** A repeater item as delivered; `fields` built like a block's. */
export interface PublicItem {
  itemId: string;
  fields: Record<string, unknown>;
}

/** Which relation fields to inline rather than leave as ids. */
export type ExpandSet = ReadonlySet<string>;

export function parseExpand(raw: string | undefined): ExpandSet {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

/** Serialises rows in three passes (collect ids, batch load, build) to avoid N+1 loads. */
export async function serializeContents(
  rows: ContentRow[],
  ctx: PublicContext,
  expand: ExpandSet,
): Promise<PublicContent[]> {
  const collected: Collected = {
    content: new Set(),
    asset: new Set(),
    user: new Set(),
    queries: new Map(),
  };
  for (const row of rows) collectRow(row, ctx.manablox, expand, collected);

  const resolved = await resolveInRounds(collected, ctx, expand);
  await loadTags(rows, ctx, resolved);
  return rows.map((row) => buildContent(row, ctx, expand, resolved));
}

export async function serializeContent(
  row: ContentRow,
  ctx: PublicContext,
  expand: ExpandSet,
): Promise<PublicContent> {
  const [only] = await serializeContents([row], ctx, expand);
  return only as PublicContent;
}
