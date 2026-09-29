import { describe, expect, it } from 'vitest';
import { signTransform, transformPath, verifyTransform } from '../src/signing.js';

const SECRET = 'a-signing-secret';
const request = { assetId: 'asset-1', preset: 'thumb', format: 'webp' };

describe('transform signing', () => {
  it('verifies a signature it produced', () => {
    expect(verifyTransform(SECRET, request, signTransform(SECRET, request))).toBe(true);
  });

  /** Each component is bound into the MAC. */
  it('rejects a signature bound to a different asset, preset or format', () => {
    const signature = signTransform(SECRET, request);
    expect(verifyTransform(SECRET, { ...request, assetId: 'asset-2' }, signature)).toBe(false);
    expect(verifyTransform(SECRET, { ...request, preset: 'hero' }, signature)).toBe(false);
    expect(verifyTransform(SECRET, { ...request, format: 'avif' }, signature)).toBe(false);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifyTransform(SECRET, request, signTransform('other', request))).toBe(false);
  });

  it('rejects malformed signatures without throwing', () => {
    for (const value of ['', 'x', 'x'.repeat(200)]) {
      expect(verifyTransform(SECRET, request, value)).toBe(false);
    }
  });

  it('builds a path carrying the signature', () => {
    const signature = signTransform(SECRET, request);
    expect(transformPath(request, signature)).toBe(`/media/asset-1/thumb.webp?s=${signature}`);
  });
});
