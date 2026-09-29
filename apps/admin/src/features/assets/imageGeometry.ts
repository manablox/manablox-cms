import type { AssetCrop, FocalPoint } from '@manablox/core';

/** The image editor's crop and focal point maths, in pixels of the turned picture. */

interface Size {
  width: number;
  height: number;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The crop and focal point after a quarter turn of a `before`-sized picture. Clockwise,
 * (x, y) of W x H lands at (H - y, x).
 */
export function turned(
  crop: AssetCrop,
  focal: FocalPoint,
  before: Size,
  quarters: 1 | -1,
): { crop: AssetCrop; focal: FocalPoint } {
  return quarters === 1
    ? {
        crop: {
          left: before.height - crop.top - crop.height,
          top: crop.left,
          width: crop.height,
          height: crop.width,
        },
        focal: { x: 1 - focal.y, y: focal.x },
      }
    : {
        crop: {
          left: crop.top,
          top: before.width - crop.left - crop.width,
          width: crop.height,
          height: crop.width,
        },
        focal: { x: focal.y, y: 1 - focal.x },
      };
}

/** The crop and focal point after mirroring a `size`d picture along `axis`. */
export function mirrored(
  crop: AssetCrop,
  focal: FocalPoint,
  size: Size,
  axis: 'x' | 'y',
): { crop: AssetCrop; focal: FocalPoint } {
  return axis === 'x'
    ? {
        crop: { ...crop, left: size.width - crop.left - crop.width },
        focal: { x: round3(1 - focal.x), y: focal.y },
      }
    : {
        crop: { ...crop, top: size.height - crop.top - crop.height },
        focal: { x: focal.x, y: round3(1 - focal.y) },
      };
}

/** The largest rectangle of `ratio` inside `crop`, around its centre; not yet normalised. */
export function fitRatio(crop: AssetCrop, ratio: number): AssetCrop {
  let width = crop.width;
  let height = Math.round(width / ratio);
  if (height > crop.height) {
    height = crop.height;
    width = Math.round(height * ratio);
  }
  return {
    left: crop.left + (crop.width - width) / 2,
    top: crop.top + (crop.height - height) / 2,
    width,
    height,
  };
}
