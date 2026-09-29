<script setup lang="ts">
import type { AssetCrop, FocalPoint } from '@manablox/core';
import { clamp } from '../useCropDrag';

/** What `cover` variants of three shapes keep of the edited image. Uses the server's maths. */
const props = defineProps<{
  url: string | null;
  crop: AssetCrop;
  focal: FocalPoint;
  hasFocal: boolean;
  /** The turned picture's pixel size. */
  natural: { width: number; height: number };
  imageStyle: (frameWidth: number) => Record<string, string>;
}>();

/** The window a `cover` fit keeps for `target`, placed around the focal point - the server's rule. */
function coverWindow(
  source: AssetCrop,
  target: { width: number; height: number },
  point: FocalPoint,
): AssetCrop {
  const r = target.width / target.height;
  let width = source.width;
  let height = Math.round(width / r);
  if (height > source.height) {
    height = source.height;
    width = Math.round(height * r);
  }
  return {
    width,
    height,
    left: clamp(Math.round(point.x * source.width - width / 2), 0, source.width - width),
    top: clamp(Math.round(point.y * source.height - height / 2), 0, source.height - height),
  };
}

const PREVIEWS = [
  { label: 'Square', width: 1, height: 1 },
  { label: 'Wide 16:9', width: 16, height: 9 },
  { label: 'Tall 3:4', width: 3, height: 4 },
];

const PREVIEW_WIDTH = 72;

/** Each preview is the turned picture, shifted so the kept window fills a fixed box. */
function previewFrame(target: { width: number; height: number }) {
  const c = props.crop;
  const window = coverWindow(c, target, props.hasFocal ? props.focal : { x: 0.5, y: 0.5 });
  const k = PREVIEW_WIDTH / window.width;
  return {
    box: {
      width: `${PREVIEW_WIDTH}px`,
      height: `${(PREVIEW_WIDTH * target.height) / target.width}px`,
    },
    inner: {
      width: `${props.natural.width * k}px`,
      height: `${props.natural.height * k}px`,
      left: `${-(c.left + window.left) * k}px`,
      top: `${-(c.top + window.top) * k}px`,
    },
    imageWidth: props.natural.width * k,
  };
}
</script>

<template>
  <div>
    <p class="mb-label">What variants keep</p>
    <div class="flex flex-col gap-2">
      <figure v-for="preview in PREVIEWS" :key="preview.label" class="m-0 flex items-center gap-3">
        <div
          class="relative shrink-0 overflow-hidden rounded-control bg-surface-100 dark:bg-surface-800"
          :style="previewFrame(preview).box"
        >
          <div class="absolute" :style="previewFrame(preview).inner">
            <img
              :src="url ?? ''"
              alt=""
              class="absolute top-1/2 left-1/2 max-w-none"
              :style="imageStyle(previewFrame(preview).imageWidth)"
              draggable="false"
            />
          </div>
        </div>
        <figcaption class="text-2xs text-surface-500">{{ preview.label }}</figcaption>
      </figure>
    </div>
  </div>
</template>
