<script setup lang="ts">
import { computed } from 'vue';
import {
  clampPanelWidth,
  PANEL_WIDTH,
  type PanelKey,
  resizingPanel,
  usePanelWidth,
} from '../../composables/usePanel';

/** Panel resize handle: drag or arrow keys to resize, double click to reset. */
const props = defineProps<{ panel: PanelKey; label: string }>();

const width = usePanelWidth(props.panel);
const dragging = computed(() => resizingPanel.value === props.panel);
/** Arrow key step in px. */
const STEP = 16;

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = width.value;
  resizingPanel.value = props.panel;
  // Keep receiving moves when the pointer outruns the handle.
  handle.setPointerCapture(event.pointerId);

  const onMove = (move: PointerEvent) => {
    width.value = clampPanelWidth(startWidth + (move.clientX - startX));
  };
  const onUp = () => {
    resizingPanel.value = null;
    handle.releasePointerCapture(event.pointerId);
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
  event.preventDefault();
}

function nudge(by: number) {
  width.value = clampPanelWidth(width.value + by);
}
</script>

<template>
  <div
    class="group mb-z-local absolute inset-y-0 right-0 hidden w-1.5 cursor-col-resize touch-none lg:block"
    role="separator"
    aria-orientation="vertical"
    :aria-label="`Resize ${label.toLowerCase()}`"
    :aria-valuenow="width"
    :aria-valuemin="PANEL_WIDTH.min"
    :aria-valuemax="PANEL_WIDTH.max"
    tabindex="0"
    @pointerdown="onPointerDown"
    @dblclick="width = PANEL_WIDTH.default"
    @keydown.left.prevent="nudge(-STEP)"
    @keydown.right.prevent="nudge(STEP)"
  >
    <!-- Visible line on hover, focus or drag; the hit target is wider. -->
    <span
      class="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-pill transition-colors duration-[var(--mb-dur-fast)] group-hover:bg-brand-500/60 group-focus-visible:bg-brand-500"
      :class="dragging ? 'bg-brand-500' : ''"
    />
  </div>
</template>
