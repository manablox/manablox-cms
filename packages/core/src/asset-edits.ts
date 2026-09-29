/** Non-destructive image edits stored on an asset's `meta`. Browser-safe. */

/** A rectangle in the original image's pixels, kept on the asset rather than baked in. */
export interface AssetCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the subject is, as fractions of the (cropped) image: `{ x: 0.5, y: 0.5 }` is centred. */
export interface FocalPoint {
  x: number;
  y: number;
}

/** Quarter turns clockwise, applied before anything is measured or cut. */
export const ASSET_ROTATIONS = [0, 90, 180, 270] as const;
export type AssetRotation = (typeof ASSET_ROTATIONS)[number];

/** Colour adjustments; `1` is neutral, except `hue` (degrees, neutral `0`). */
export interface AssetAdjustments {
  brightness?: number | undefined;
  saturation?: number | undefined;
  contrast?: number | undefined;
  hue?: number | undefined;
}

/** Allowed range per adjustment. */
export const ASSET_ADJUSTMENT_RANGES: Readonly<
  Record<keyof AssetAdjustments, { readonly min: number; readonly max: number }>
> = {
  brightness: { min: 0.1, max: 3 },
  saturation: { min: 0, max: 3 },
  contrast: { min: 0.1, max: 3 },
  hue: { min: -180, max: 180 },
};

export const NEUTRAL_ADJUSTMENTS: Readonly<Record<keyof AssetAdjustments, number>> = {
  brightness: 1,
  saturation: 1,
  contrast: 1,
  hue: 0,
};

/** A named look, applied after the adjustments. */
export const ASSET_EFFECTS = ['none', 'grayscale', 'sepia', 'invert'] as const;
export type AssetEffect = (typeof ASSET_EFFECTS)[number];

/**
 * Non-destructive image edits, applied in a fixed order the admin preview matches:
 * orientation, crop, focal window, resize, colour.
 */
export interface AssetImageEdits {
  crop?: AssetCrop | null | undefined;
  focalPoint?: FocalPoint | null | undefined;
  /** Quarter turns clockwise; the crop is drawn on the rotated image. */
  rotate?: AssetRotation | null | undefined;
  /** Mirrored left to right, and top to bottom. */
  flipHorizontal?: boolean | null | undefined;
  flipVertical?: boolean | null | undefined;
  adjust?: AssetAdjustments | null | undefined;
  effect?: AssetEffect | null | undefined;
}
