import {
  ASSET_ADJUSTMENT_RANGES,
  ASSET_EFFECTS,
  ASSET_ROTATIONS,
  type AssetAdjustments,
  type AssetCrop,
  type AssetEffect,
  type AssetImageEdits,
  type AssetRotation,
  type FocalPoint,
  ManabloxError,
} from '@manablox/core';

/** The edits in an asset's `meta`; invalid values are ignored. */
export function readImageEdits(meta: Record<string, unknown> | null | undefined): AssetImageEdits {
  const edits: AssetImageEdits = {};
  const crop = meta?.crop as Partial<AssetCrop> | undefined;
  if (crop && [crop.left, crop.top, crop.width, crop.height].every(isFiniteNumber)) {
    edits.crop = {
      left: crop.left as number,
      top: crop.top as number,
      width: crop.width as number,
      height: crop.height as number,
    };
  }
  const focal = meta?.focalPoint as Partial<FocalPoint> | undefined;
  if (focal && isFiniteNumber(focal.x) && isFiniteNumber(focal.y)) {
    edits.focalPoint = { x: focal.x as number, y: focal.y as number };
  }

  const rotate = meta?.rotate;
  if (ASSET_ROTATIONS.includes(rotate as AssetRotation)) edits.rotate = rotate as AssetRotation;
  if (meta?.flipHorizontal === true) edits.flipHorizontal = true;
  if (meta?.flipVertical === true) edits.flipVertical = true;

  const effect = meta?.effect;
  if (ASSET_EFFECTS.includes(effect as AssetEffect)) edits.effect = effect as AssetEffect;

  const adjust = readAdjustments(meta?.adjust);
  if (adjust) edits.adjust = adjust;

  return edits;
}

/** The adjustments on `meta`, each clamped to its range; `null` when none are set. */
function readAdjustments(raw: unknown): AssetAdjustments | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const out: AssetAdjustments = {};
  for (const key of Object.keys(ASSET_ADJUSTMENT_RANGES) as (keyof AssetAdjustments)[]) {
    const value = source[key];
    if (!isFiniteNumber(value)) continue;
    const { min, max } = ASSET_ADJUSTMENT_RANGES[key];
    out[key] = Math.min(max, Math.max(min, value));
  }
  return Object.keys(out).length ? out : null;
}

/** Whether the adjustments would change a pixel. */
export function hasAdjustments(adjust: AssetAdjustments | null | undefined): boolean {
  if (!adjust) return false;
  return (
    (adjust.brightness !== undefined && adjust.brightness !== 1) ||
    (adjust.saturation !== undefined && adjust.saturation !== 1) ||
    (adjust.contrast !== undefined && adjust.contrast !== 1) ||
    (adjust.hue !== undefined && adjust.hue !== 0)
  );
}

/** Validates edits against the image: a whole-pixel crop inside it, a focal point in [0, 1]. */
export function validateImageEdits(
  edits: AssetImageEdits,
  image: { width: number; height: number },
): AssetImageEdits {
  const out: AssetImageEdits = {};

  if (edits.crop) {
    const crop = edits.crop;
    const whole = [crop.left, crop.top, crop.width, crop.height].every(Number.isInteger);
    const inside =
      crop.left >= 0 &&
      crop.top >= 0 &&
      crop.width >= 1 &&
      crop.height >= 1 &&
      crop.left + crop.width <= image.width &&
      crop.top + crop.height <= image.height;
    if (!whole || !inside) {
      throw ManabloxError.badRequest('asset.crop.outOfBounds', { ...crop, ...image });
    }
    // A whole-image crop is dropped.
    if (
      crop.left !== 0 ||
      crop.top !== 0 ||
      crop.width !== image.width ||
      crop.height !== image.height
    ) {
      out.crop = crop;
    }
  }

  if (edits.focalPoint) {
    const { x, y } = edits.focalPoint;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
      throw ManabloxError.badRequest('asset.focalPoint.outOfBounds', { x, y });
    }
    out.focalPoint = { x: round3(x), y: round3(y) };
  }

  // Neutral values are not stored.
  if (edits.rotate && ASSET_ROTATIONS.includes(edits.rotate)) out.rotate = edits.rotate;
  if (edits.flipHorizontal) out.flipHorizontal = true;
  if (edits.flipVertical) out.flipVertical = true;
  if (edits.effect && edits.effect !== 'none' && ASSET_EFFECTS.includes(edits.effect)) {
    out.effect = edits.effect;
  }

  const adjust = readAdjustments(edits.adjust);
  if (hasAdjustments(adjust)) out.adjust = adjust;

  return out;
}

/** The image's size after rotation; a quarter turn swaps the axes. */
export function rotatedSize(
  size: { width: number; height: number },
  rotate: AssetRotation | null | undefined,
): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: size.height, height: size.width } : size;
}

/**
 * The region a `cover` resize keeps, centred on the focal point as far as the edges allow.
 * Sharp's `position` supports only edges and centres.
 */
export function coverWindow(
  source: { width: number; height: number },
  target: { width: number; height: number },
  focal: FocalPoint = { x: 0.5, y: 0.5 },
): AssetCrop {
  const ratio = target.width / target.height;
  let width = source.width;
  let height = Math.round(source.width / ratio);
  if (height > source.height) {
    height = source.height;
    width = Math.round(source.height * ratio);
  }
  width = Math.max(1, Math.min(width, source.width));
  height = Math.max(1, Math.min(height, source.height));

  const left = clamp(Math.round(focal.x * source.width - width / 2), 0, source.width - width);
  const top = clamp(Math.round(focal.y * source.height - height / 2), 0, source.height - height);
  return { left, top, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
