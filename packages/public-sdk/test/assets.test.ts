import { describe, expect, it } from 'vitest';
import { assetSrcSet, assetUrl, isImage } from '../src/assets.js';
import type { Asset } from '../src/types.js';

const asset: Asset = {
  id: 'a1',
  url: 'https://cdn.test/original.jpg',
  filename: 'original.jpg',
  mimeType: 'image/jpeg',
  size: 100,
  width: 1600,
  height: 900,
  alt: 'A photo',
  title: null,
  variants: {
    thumb: 'https://cdn.test/media/a1/thumb.webp?s=abc',
    card: 'https://cdn.test/media/a1/card.webp?s=def',
  },
};

describe('assetUrl', () => {
  it('returns the original when no preset is asked for', () => {
    expect(assetUrl(asset)).toBe(asset.url);
  });

  it('returns the server-signed variant for a preset', () => {
    expect(assetUrl(asset, { preset: 'thumb' })).toContain('s=abc');
  });

  /** The SDK cannot sign transform URLs. */
  it('falls back to the original for an unknown preset rather than guessing a path', () => {
    expect(assetUrl(asset, { preset: 'nonexistent' })).toBe(asset.url);
    const { variants: _variants, ...withoutVariants } = asset;
    expect(assetUrl(withoutVariants, { preset: 'thumb' })).toBe(asset.url);
  });

  it('prefers a format-qualified variant when the instance publishes one', () => {
    const withAvif = {
      ...asset,
      variants: { ...asset.variants, 'thumb.avif': 'https://cdn.test/a1/thumb.avif?s=xyz' },
    };
    expect(assetUrl(withAvif, { preset: 'thumb', format: 'avif' })).toContain('thumb.avif');
    expect(assetUrl(withAvif, { preset: 'thumb' })).toContain('thumb.webp');
  });
});

describe('helpers', () => {
  it('builds a srcset across presets', () => {
    expect(assetSrcSet(asset, { thumb: 320, card: 640 })).toBe(
      'https://cdn.test/media/a1/thumb.webp?s=abc 320w, https://cdn.test/media/a1/card.webp?s=def 640w',
    );
  });

  it('knows what is renderable as an image', () => {
    expect(isImage(asset)).toBe(true);
    expect(isImage({ ...asset, mimeType: 'application/pdf' })).toBe(false);
  });
});
