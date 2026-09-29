import type { AssetAdjustments, AssetEffect } from '@manablox/core';

/** The colour sliders, in the ranges the server accepts. */
export const COLOUR_SLIDERS: Array<{
  key: keyof AssetAdjustments;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'brightness', label: 'Brightness', min: 0.2, max: 2, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0.2, max: 2, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
];

export const COLOUR_EFFECTS: Array<{ value: AssetEffect; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'grayscale', label: 'Grey' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'invert', label: 'Invert' },
];

/** Whether the colour is left as it is. */
export function isNeutralColour(
  adjust: Record<keyof AssetAdjustments, number>,
  effect: AssetEffect,
): boolean {
  return (
    adjust.brightness === 1 &&
    adjust.contrast === 1 &&
    adjust.saturation === 1 &&
    adjust.hue === 0 &&
    effect === 'none'
  );
}

/** The browser's own equivalent of what sharp will do, as a CSS `filter`. */
export function imageFilter(
  adjust: Record<keyof AssetAdjustments, number>,
  effect: AssetEffect,
): string {
  const parts = [
    `brightness(${adjust.brightness})`,
    `contrast(${adjust.contrast})`,
    `saturate(${adjust.saturation})`,
    `hue-rotate(${adjust.hue}deg)`,
  ];
  if (effect === 'grayscale') parts.push('grayscale(1)');
  if (effect === 'sepia') parts.push('sepia(1)');
  if (effect === 'invert') parts.push('invert(1)');
  return parts.join(' ');
}
