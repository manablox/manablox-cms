<script setup lang="ts">
import type { AssetCrop, FocalPoint } from '@manablox/core';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { CROP_HANDLES, clamp, useCropDrag } from '../useCropDrag';

/**
 * The image editor's picture: the turned image at fit-to-width, the crop frame drawn over it
 * (dragged in crop mode) and the focal point (placed by a click in focal mode).
 */
const props = defineProps<{
  url: string | null;
  name: string;
  mode: 'crop' | 'focal' | 'colour';
  /** The turned picture's pixel size. */
  natural: { width: number; height: number };
  /** The locked crop ratio, if any. */
  ratio: number | null;
  imageStyle: (frameWidth: number) => Record<string, string>;
}>();

const crop = defineModel<AssetCrop>('crop', { required: true });
const focal = defineModel<FocalPoint>('focal', { required: true });
const hasFocal = defineModel<boolean>('hasFocal', { required: true });

const stage = ref<HTMLElement | null>(null);
/** Displayed pixels per image pixel, measured on the stage rather than assumed. */
const scale = ref(1);
const loaded = ref(false);

function measure() {
  if (!stage.value) return;
  scale.value = stage.value.clientWidth / props.natural.width;
}
const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
watch(stage, (element) => {
  if (element && observer) observer.observe(element);
});
watch(
  () => props.natural,
  () => measure(),
);
onBeforeUnmount(() => observer?.disconnect());

/** The frame's height limit; its width is a CSS `min()` of the column and this. */
const STAGE_MAX_HEIGHT = '52vh';
const stageStyle = computed(() => ({
  aspectRatio: `${props.natural.width} / ${props.natural.height}`,
  width: `min(100%, calc(${STAGE_MAX_HEIGHT} * ${props.natural.width} / ${props.natural.height}))`,
}));

const box = computed(() => ({
  left: crop.value.left * scale.value,
  top: crop.value.top * scale.value,
  width: crop.value.width * scale.value,
  height: crop.value.height * scale.value,
}));

const { onPointerDown } = useCropDrag({
  crop,
  scale,
  ratio: computed(() => props.ratio),
  bounds: () => props.natural,
});

/** In focal mode a click inside the crop places the point; the fraction is of the crop. */
function onStageClick(event: MouseEvent) {
  if (props.mode !== 'focal' || !stage.value) return;
  const rect = stage.value.getBoundingClientRect();
  const x = (event.clientX - rect.left) / scale.value;
  const y = (event.clientY - rect.top) / scale.value;
  const c = crop.value;
  focal.value = {
    x: Math.round(clamp((x - c.left) / c.width, 0, 1) * 1000) / 1000,
    y: Math.round(clamp((y - c.top) / c.height, 0, 1) * 1000) / 1000,
  };
  hasFocal.value = true;
}

const focalStyle = computed(() => ({
  left: `${(crop.value.left + focal.value.x * crop.value.width) * scale.value}px`,
  top: `${(crop.value.top + focal.value.y * crop.value.height) * scale.value}px`,
}));
</script>

<template>
  <!-- Explicit width: the content is absolute, so `w-fit` would collapse. -->
  <div
    class="relative mx-auto max-w-full overflow-hidden rounded-control bg-surface-900 [background-image:linear-gradient(45deg,#8883_25%,transparent_25%,transparent_75%,#8883_75%),linear-gradient(45deg,#8883_25%,transparent_25%,transparent_75%,#8883_75%)] [background-position:0_0,8px_8px] [background-size:16px_16px]"
    :style="stageStyle"
  >
    <div
      ref="stage"
      class="absolute inset-0 overflow-hidden"
      :class="mode === 'focal' ? 'cursor-crosshair' : ''"
      @click="onStageClick"
    >
      <img
        :src="url ?? ''"
        :alt="name"
        class="absolute top-1/2 left-1/2 max-w-none"
        :style="imageStyle(natural.width * scale)"
        draggable="false"
        @load="loaded = true; measure()"
      />

      <template v-if="loaded">
        <!-- Everything outside the crop is dimmed, in every mode. -->
        <div class="pointer-events-none absolute inset-0 bg-black/55" :style="{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${box.top}px, ${box.left}px ${box.top}px, ${box.left}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top + box.height}px, ${box.left + box.width}px ${box.top}px, 0 ${box.top}px)` }" />

        <div
          class="absolute border border-white shadow-[0_0_0_1px_rgba(0,0,0,.5)]"
          :class="mode === 'crop' ? 'cursor-move' : 'pointer-events-none'"
          :style="{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }"
          role="group"
          aria-label="Crop"
          @pointerdown="mode === 'crop' && onPointerDown('move', $event)"
        >
          <!-- Thirds. -->
          <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-60">
            <div v-for="n in 9" :key="n" class="border-white/40 [&:nth-child(3n)]:border-r-0 [&:nth-child(n+7)]:border-b-0 border-r border-b" />
          </div>
          <button
            v-for="handle in CROP_HANDLES"
            v-show="mode === 'crop'"
            :key="handle.id"
            type="button"
            class="absolute h-3 w-3 rounded-sm border border-surface-900 bg-white"
            :class="handle.class"
            :aria-label="`Resize crop (${handle.id})`"
            @pointerdown="onPointerDown(handle.id, $event)"
          />
        </div>

        <div
          v-if="hasFocal || mode === 'focal'"
          class="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-iris-400 shadow-[0_0_0_2px_rgba(0,0,0,.6)]"
          :class="mode === 'focal' ? '' : 'opacity-50'"
          :style="focalStyle"
          aria-hidden="true"
        >
          <span class="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-iris-400" />
        </div>
      </template>
    </div>
  </div>
</template>
