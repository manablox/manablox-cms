import type { AssetCrop } from '@manablox/core';
import { onBeforeUnmount, type Ref } from 'vue';

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** The resize handles around the crop frame, with their placement and cursor. */
export const CROP_HANDLES: Array<{ id: CropHandle; class: string }> = [
  { id: 'nw', class: '-top-1.5 -left-1.5 cursor-nwse-resize' },
  { id: 'n', class: '-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
  { id: 'ne', class: '-top-1.5 -right-1.5 cursor-nesw-resize' },
  { id: 'e', class: 'top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize' },
  { id: 'se', class: '-right-1.5 -bottom-1.5 cursor-nwse-resize' },
  { id: 's', class: '-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize' },
  { id: 'sw', class: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { id: 'w', class: 'top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize' },
];

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/** Keeps a rectangle whole-pixel, at least 16px a side, and inside `bounds`. */
export function normaliseCrop(
  rect: AssetCrop,
  bounds: { width: number; height: number },
): AssetCrop {
  const width = clamp(Math.round(rect.width), 16, bounds.width);
  const height = clamp(Math.round(rect.height), 16, bounds.height);
  return {
    width,
    height,
    left: clamp(Math.round(rect.left), 0, bounds.width - width),
    top: clamp(Math.round(rect.top), 0, bounds.height - height),
  };
}

/**
 * Moves and resizes `crop` by pointer. `scale` is displayed pixels per image pixel; a
 * fixed `ratio` makes the dragged side lead and derives the other.
 */
export function useCropDrag(options: {
  crop: Ref<AssetCrop>;
  scale: Readonly<Ref<number>>;
  ratio: Readonly<Ref<number | null>>;
  bounds: () => { width: number; height: number };
}) {
  const { crop, scale, ratio } = options;
  let drag: { handle: CropHandle; startX: number; startY: number; start: AssetCrop } | null = null;

  function onPointerDown(handle: CropHandle, event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    drag = { handle, startX: event.clientX, startY: event.clientY, start: { ...crop.value } };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / scale.value;
    const dy = (event.clientY - drag.startY) / scale.value;
    const s = drag.start;
    const handle = drag.handle;

    if (handle === 'move') {
      crop.value = normaliseCrop({ ...s, left: s.left + dx, top: s.top + dy }, options.bounds());
      return;
    }

    let { left, top, width, height } = s;
    if (handle.includes('e')) width = s.width + dx;
    if (handle.includes('s')) height = s.height + dy;
    if (handle.includes('w')) {
      width = s.width - dx;
      left = s.left + dx;
    }
    if (handle.includes('n')) {
      height = s.height - dy;
      top = s.top + dy;
    }

    const target = ratio.value;
    if (target) {
      // A corner follows whichever axis moved more.
      const horizontal =
        handle === 'e' || handle === 'w' || (handle.length === 2 && Math.abs(dx) >= Math.abs(dy));
      if (horizontal) height = width / target;
      else width = height * target;
      if (handle.includes('w')) left = s.left + s.width - width;
      if (handle.includes('n')) top = s.top + s.height - height;
    }

    crop.value = normaliseCrop({ left, top, width, height }, options.bounds());
  }

  function onPointerUp() {
    drag = null;
    window.removeEventListener('pointermove', onPointerMove);
  }

  onBeforeUnmount(onPointerUp);

  return { onPointerDown };
}
