import type { ImageEditorState } from '@manablox/admin-sdk/features/assets/queries';
import type {
  AssetAdjustments,
  AssetCrop,
  AssetEffect,
  AssetRotation,
  FocalPoint,
} from '@manablox/core';
import { computed, ref } from 'vue';
import { imageFilter, isNeutralColour } from './imageFilter';
import { fitRatio, mirrored, turned } from './imageGeometry';
import { normaliseCrop } from './useCropDrag';

/**
 * An image's non-destructive edits while the editor is open: orientation, crop (with a
 * ratio lock), focal point and colour. Turning and mirroring carry the crop and focal
 * point along. `edits()` is what the server stores.
 */
export function useImageEdits(
  /** The stored pixel size, before any turn. */
  stored: { width: number; height: number },
  initial: ImageEditorState,
) {
  const rotate = ref<AssetRotation>(initial.rotate);
  const flipHorizontal = ref(initial.flipHorizontal);
  const flipVertical = ref(initial.flipVertical);
  const adjust = ref<Record<keyof AssetAdjustments, number>>({ ...initial.adjust });
  const effect = ref<AssetEffect>(initial.effect);

  /** The image as the editor sees it: a quarter turn swaps the axes. */
  const natural = computed(() =>
    rotate.value === 90 || rotate.value === 270
      ? { width: stored.height, height: stored.width }
      : { width: stored.width, height: stored.height },
  );

  const crop = ref<AssetCrop>(initial.crop ?? { left: 0, top: 0, ...natural.value });
  const focal = ref<FocalPoint>(initial.focalPoint ?? { x: 0.5, y: 0.5 });
  const hasFocal = ref(initial.focalPoint !== null);

  const RATIOS: Array<{ id: string; label: string; ratio: number | null }> = [
    { id: 'free', label: 'Free', ratio: null },
    { id: 'original', label: 'Original', ratio: stored.width / stored.height },
    { id: '1:1', label: '1:1', ratio: 1 },
    { id: '4:3', label: '4:3', ratio: 4 / 3 },
    { id: '3:2', label: '3:2', ratio: 3 / 2 },
    { id: '16:9', label: '16:9', ratio: 16 / 9 },
  ];
  const ratioId = ref('free');
  const ratio = computed(() => RATIOS.find((option) => option.id === ratioId.value)?.ratio ?? null);

  // --- orientation -----------------------------------------------------------------

  /** A quarter turn swaps the axes, so the two mirrors swap with them. */
  const swapped = computed(() => rotate.value === 90 || rotate.value === 270);

  /** Turns the picture a quarter; the crop and focal point turn with it. */
  function turn(quarters: 1 | -1) {
    const next = turned(crop.value, focal.value, natural.value, quarters);
    rotate.value = ((((rotate.value + quarters * 90) % 360) + 360) % 360) as AssetRotation;
    crop.value = next.crop;
    focal.value = next.focal;
    ratioId.value = 'free';
  }

  /**
   * Stored as mirror-then-turn, the order sharp applies. At a quarter turn a button toggles
   * the other flag so it matches the screen; crop and focal point mirror too.
   */
  const mirroredHorizontally = computed(() =>
    swapped.value ? flipVertical.value : flipHorizontal.value,
  );
  const mirroredVertically = computed(() =>
    swapped.value ? flipHorizontal.value : flipVertical.value,
  );

  function mirror(axis: 'x' | 'y') {
    const stored = (axis === 'x') === !swapped.value ? 'flipHorizontal' : 'flipVertical';
    if (stored === 'flipHorizontal') flipHorizontal.value = !flipHorizontal.value;
    else flipVertical.value = !flipVertical.value;

    const next = mirrored(crop.value, focal.value, natural.value, axis);
    crop.value = next.crop;
    focal.value = next.focal;
  }

  // --- crop and focal point --------------------------------------------------------

  const isWholeImage = computed(
    () =>
      crop.value.left === 0 &&
      crop.value.top === 0 &&
      crop.value.width === natural.value.width &&
      crop.value.height === natural.value.height,
  );

  function applyRatio(id: string) {
    ratioId.value = id;
    const target = RATIOS.find((option) => option.id === id)?.ratio;
    if (!target) return;
    // Keep the centre, fit the largest rectangle of that shape inside the current crop.
    crop.value = normaliseCrop(fitRatio(crop.value, target), natural.value);
  }

  function resetCrop() {
    crop.value = { left: 0, top: 0, ...natural.value };
    ratioId.value = 'free';
  }
  function resetFocal() {
    focal.value = { x: 0.5, y: 0.5 };
    hasFocal.value = false;
  }

  // --- colour ----------------------------------------------------------------------

  const isNeutral = computed(() => isNeutralColour(adjust.value, effect.value));
  const filter = computed(() => imageFilter(adjust.value, effect.value));

  /** The frame is the turned picture; the image keeps its proportions and is turned into place. */
  function imageStyle(frameWidth: number) {
    const turned = rotate.value === 90 || rotate.value === 270;
    const width = turned ? (frameWidth * stored.width) / stored.height : frameWidth;
    // Right to left: mirror, then turn, as sharp applies them.
    const flips = `scaleX(${flipHorizontal.value ? -1 : 1}) scaleY(${flipVertical.value ? -1 : 1})`;
    return {
      width: `${width}px`,
      transform: `translate(-50%, -50%) rotate(${rotate.value}deg) ${flips}`,
      filter: filter.value,
    };
  }

  /** The edits as the server stores them; defaults are sent as `null`. */
  function edits() {
    return {
      crop: isWholeImage.value ? null : crop.value,
      focalPoint: hasFocal.value ? focal.value : null,
      rotate: rotate.value === 0 ? null : rotate.value,
      flipHorizontal: flipHorizontal.value,
      flipVertical: flipVertical.value,
      adjust: isNeutral.value ? null : { ...adjust.value },
      effect: effect.value === 'none' ? null : effect.value,
    };
  }

  return {
    rotate,
    adjust,
    effect,
    natural,
    crop,
    focal,
    hasFocal,
    RATIOS,
    ratioId,
    ratio,
    turn,
    mirroredHorizontally,
    mirroredVertically,
    mirror,
    isWholeImage,
    applyRatio,
    resetCrop,
    resetFocal,
    imageStyle,
    edits,
  };
}
