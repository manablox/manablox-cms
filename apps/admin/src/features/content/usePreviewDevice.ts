import { BREAKPOINTS } from '@manablox/admin-sdk/features/content/model/block-grid';
import type { BlockBreakpoint } from '@manablox/core';
import { computed, onScopeDispose, ref, watch } from 'vue';

/** Desktop never renders narrower than this. */
const DESKTOP_MIN = 1024;

/** Device width for a preview frame that renders at the real width and is scaled to fit its canvas. */
export function usePreviewDevice() {
  const device = ref<BlockBreakpoint>('desktop');
  const deviceOptions = BREAKPOINTS.map((entry) => ({
    value: entry.value,
    label: entry.label,
    icon: entry.icon,
    hint: entry.width ? `${entry.width}px` : 'Full width',
  }));
  const deviceLabel = computed(
    () => BREAKPOINTS.find((entry) => entry.value === device.value)?.label ?? 'Desktop',
  );

  /** The element the frame is fitted into. */
  const canvas = ref<HTMLElement | null>(null);
  const canvasSize = ref({ width: 0, height: 0 });
  let observer: ResizeObserver | null = null;
  watch(
    canvas,
    (element) => {
      observer?.disconnect();
      observer = null;
      if (!element) return;
      observer = new ResizeObserver(([entry]) => {
        if (entry)
          canvasSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
      });
      observer.observe(element);
    },
    { immediate: true, flush: 'post' },
  );
  onScopeDispose(() => observer?.disconnect());

  const frameWidth = computed(() => {
    const width = BREAKPOINTS.find((entry) => entry.value === device.value)?.width;
    return width ?? Math.max(DESKTOP_MIN, Math.round(canvasSize.value.width));
  });
  const scale = computed(() =>
    canvasSize.value.width ? Math.min(1, canvasSize.value.width / frameWidth.value) : 1,
  );
  const frameStyle = computed(() => ({
    width: `${frameWidth.value}px`,
    height: `${canvasSize.value.height / scale.value}px`,
    transform: `scale(${scale.value})`,
    transformOrigin: 'top left',
  }));
  const frameBoxStyle = computed(() => ({
    width: `${frameWidth.value * scale.value}px`,
    height: `${canvasSize.value.height}px`,
  }));

  return {
    device,
    deviceOptions,
    deviceLabel,
    canvas,
    frameWidth,
    scale,
    frameStyle,
    frameBoxStyle,
  };
}
