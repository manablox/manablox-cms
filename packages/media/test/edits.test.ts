import { describe, expect, it } from 'vitest';
import {
  coverWindow,
  hasAdjustments,
  readImageEdits,
  rotatedSize,
  validateImageEdits,
} from '../src/edits.js';

describe('coverWindow', () => {
  it('keeps the whole width of a wide source for a wider target and centres by default', () => {
    // 4000x3000 into 16:9 trims the height.
    const window = coverWindow({ width: 4000, height: 3000 }, { width: 1600, height: 900 });
    expect(window).toEqual({ left: 0, top: 375, width: 4000, height: 2250 });
  });

  it('follows the focal point', () => {
    const source = { width: 4000, height: 3000 };
    const target = { width: 1600, height: 900 };
    expect(coverWindow(source, target, { x: 0.5, y: 0 })).toMatchObject({ top: 0 });
    expect(coverWindow(source, target, { x: 0.5, y: 1 })).toMatchObject({ top: 750 });
    expect(coverWindow(source, target, { x: 0.5, y: 0.25 })).toMatchObject({ top: 0 });
  });

  it('never lets the window leave the image', () => {
    const window = coverWindow(
      { width: 1000, height: 1000 },
      { width: 100, height: 300 },
      { x: 0.02, y: 0.9 },
    );
    expect(window.left).toBe(0);
    expect(window.left + window.width).toBeLessThanOrEqual(1000);
    expect(window.top + window.height).toBeLessThanOrEqual(1000);
    expect(window).toMatchObject({ width: 333, height: 1000 });
  });
});

describe('validateImageEdits', () => {
  const image = { width: 800, height: 600 };

  it('refuses a crop that leaves the image or is not whole pixels', () => {
    expect(() =>
      validateImageEdits({ crop: { left: 700, top: 0, width: 200, height: 100 } }, image),
    ).toThrow(/asset.crop.outOfBounds/);
    expect(() =>
      validateImageEdits({ crop: { left: 0.5, top: 0, width: 200, height: 100 } }, image),
    ).toThrow(/asset.crop.outOfBounds/);
  });

  it('treats a crop of the whole image as no crop', () => {
    expect(validateImageEdits({ crop: { left: 0, top: 0, ...image } }, image)).toEqual({});
  });

  it('keeps a focal point inside the unit square, rounded', () => {
    expect(validateImageEdits({ focalPoint: { x: 0.33333, y: 1 } }, image)).toEqual({
      focalPoint: { x: 0.333, y: 1 },
    });
    expect(() => validateImageEdits({ focalPoint: { x: 1.2, y: 0 } }, image)).toThrow(
      /asset.focalPoint.outOfBounds/,
    );
  });
});

describe('readImageEdits', () => {
  it('ignores malformed values rather than failing a render', () => {
    expect(readImageEdits({ crop: { left: 'a' }, focalPoint: { x: 0.2, y: 0.4 } })).toEqual({
      focalPoint: { x: 0.2, y: 0.4 },
    });
    expect(readImageEdits(null)).toEqual({});
  });
});

describe('orientation and colour', () => {
  const image = { width: 4000, height: 3000 };

  it('swaps the axes for a quarter turn and leaves them for a half one', () => {
    expect(rotatedSize(image, 90)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(image, 270)).toEqual({ width: 3000, height: 4000 });
    expect(rotatedSize(image, 180)).toEqual(image);
    expect(rotatedSize(image, null)).toEqual(image);
  });

  it('keeps only the edits that do something', () => {
    const neutral = validateImageEdits(
      {
        rotate: 0,
        flipHorizontal: false,
        flipVertical: false,
        effect: 'none',
        adjust: { brightness: 1, contrast: 1, saturation: 1, hue: 0 },
      },
      image,
    );
    expect(neutral).toEqual({});

    const real = validateImageEdits(
      { rotate: 90, flipVertical: true, effect: 'sepia', adjust: { contrast: 1.4 } },
      // The caller passes the turned size.
      rotatedSize(image, 90),
    );
    expect(real).toEqual({
      rotate: 90,
      flipVertical: true,
      effect: 'sepia',
      adjust: { contrast: 1.4 },
    });
  });

  it('clamps an adjustment to its range rather than refusing it', () => {
    const edits = validateImageEdits({ adjust: { brightness: 99, hue: -900 } }, image);
    expect(edits.adjust).toEqual({ brightness: 3, hue: -180 });
  });

  it('reads what is on meta and ignores what it cannot use', () => {
    const edits = readImageEdits({
      rotate: 45,
      effect: 'kodachrome',
      flipHorizontal: true,
      adjust: { contrast: 1.2, saturation: 'lots' },
    });
    expect(edits.rotate).toBeUndefined();
    expect(edits.effect).toBeUndefined();
    expect(edits.flipHorizontal).toBe(true);
    expect(edits.adjust).toEqual({ contrast: 1.2 });
  });

  it('knows a neutral set of adjustments from one that changes a pixel', () => {
    expect(hasAdjustments(null)).toBe(false);
    expect(hasAdjustments({ brightness: 1, hue: 0 })).toBe(false);
    expect(hasAdjustments({ brightness: 1.01 })).toBe(true);
  });
});
