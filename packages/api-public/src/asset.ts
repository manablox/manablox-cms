import { trackAsset } from '@manablox/cache';
import type { AssetRow } from '@manablox/db';
import { imageSizePreset, readImageSizes } from '@manablox/fields';
import { absoluteMediaUrl, readImageEdits } from '@manablox/media';
import type { PublicContext } from './context.js';
import type { PublicAsset, PublicTag } from './serialize.js';

export const toPublicTags = (tags: { name: string; slug: string }[]): PublicTag[] =>
  tags.map((tag) => ({ name: tag.name, slug: tag.slug }));

/** A field's presets and sizes for an asset; absent means every configured preset. */
export interface AssetVariantSpec {
  presets?: unknown;
  sizes?: unknown;
}

export function serializeAsset(
  asset: AssetRow,
  ctx: PublicContext,
  spec?: AssetVariantSpec,
  tags: PublicTag[] = [],
): PublicAsset {
  // Absolute, since consumers run on their own origin.
  const base = ctx.manablox.config.server.publicUrl;
  const edits = readImageEdits(asset.meta);
  trackAsset(ctx.touched, asset.id);

  return {
    id: asset.id,
    url: absoluteMediaUrl(ctx.media.urlFor(asset), base),
    variants: buildVariants(asset, ctx, spec),
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    alt: asset.alt,
    title: asset.title,
    focalPoint: edits.focalPoint ?? null,
    crop: edits.crop ?? null,
    tags,
  };
}

/** Sizes are keyed by field-given name but rendered by dimensions, so equal sizes share a file. */
function buildVariants(
  asset: AssetRow,
  ctx: PublicContext,
  spec?: AssetVariantSpec,
): Record<string, string> {
  if (!asset.mimeType.startsWith('image/')) return {};

  const presets = ctx.manablox.config.media.presets;
  const base = ctx.manablox.config.server.publicUrl;
  const wanted = Array.isArray(spec?.presets)
    ? spec.presets.filter((name): name is string => typeof name === 'string')
    : [];

  const out: Record<string, string> = {};
  for (const [name, preset] of Object.entries(presets)) {
    if (wanted.length && !wanted.includes(name)) continue;
    out[name] = absoluteMediaUrl(ctx.media.urlFor(asset, name, preset.format ?? 'webp'), base);
  }
  for (const size of readImageSizes(spec)) {
    out[size.name] = absoluteMediaUrl(
      ctx.media.urlFor(asset, imageSizePreset(size), size.format),
      base,
    );
  }
  return out;
}
