import type { Asset } from './types.js';

export interface AssetUrlOptions {
  /** A preset configured on the instance, e.g. `thumb`. */
  preset?: string;
  /** Format, for instances that publish format-qualified variants. */
  format?: string;
}

/**
 * An asset's URL, optionally a preset from `asset.variants` (signed server-side). An
 * unknown preset falls back to the original.
 */
export function assetUrl(asset: Asset, options: AssetUrlOptions = {}): string {
  if (!options.preset) return asset.url;

  const variants = asset.variants ?? {};
  const qualified = options.format ? variants[`${options.preset}.${options.format}`] : undefined;
  return qualified ?? variants[options.preset] ?? asset.url;
}

/** A `srcset` from presets mapped to their widths. */
export function assetSrcSet(asset: Asset, presets: Record<string, number>): string {
  return Object.entries(presets)
    .map(([preset, width]) => `${assetUrl(asset, { preset })} ${width}w`)
    .filter((entry) => !entry.startsWith(asset.url) || Object.keys(presets).length === 1)
    .join(', ');
}

/** True for image assets. */
export function isImage(asset: Asset): boolean {
  return asset.mimeType.startsWith('image/');
}
