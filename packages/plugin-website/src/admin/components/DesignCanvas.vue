<script setup lang="ts">
import { BREAKPOINTS, Icon, SegmentedControl, Select } from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import { type NodeRef, PALETTE_TYPE } from '@manablox/site';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { CANVAS_PATH } from '../model/canvas';
import { paletteDragKind } from '../model/elements';
import { type CanvasPayload, useDesignCanvas } from '../useDesignCanvas';

/**
 * The site process's design canvas in a frame, with a breakpoint switch and zoom. The
 * admin pushes the render input and draft CSS; the canvas reports selection and edits.
 */
const props = withDefaults(
  defineProps<{
    /** The site process origin; the canvas lives at its `/_manablox/canvas`. */
    siteUrl: string | null;
    payload: CanvasPayload | null;
    highlight?: NodeRef[];
    readOnly?: boolean;
    title?: string;
    /** Edge to edge, for a designer's workspace; otherwise a framed card. */
    flush?: boolean;
  }>(),
  { highlight: () => [], readOnly: false, title: 'Design canvas', flush: false },
);
const breakpoint = defineModel<BlockBreakpoint>('breakpoint', { default: 'desktop' });
/** Which of the theme's color schemes the canvas shows. */
const scheme = defineModel<'light' | 'dark'>('scheme', { default: 'light' });
const emit = defineEmits<{
  selectNode: [node: NodeRef | null];
  hoverNode: [node: NodeRef | null];
  moveNode: [node: NodeRef, parent: NodeRef, index: number];
  insertNode: [parent: NodeRef, index: number, element: string];
  removeNode: [node: NodeRef];
  editText: [node: NodeRef, text: string, locale: string, field: (string | number)[] | null];
  /** CSS pixels; the editor snaps them to its size steps. */
  resizeNode: [node: NodeRef, size: { width?: number; height?: number }];
}>();

const iframe = ref<HTMLIFrameElement | null>(null);
const origin = computed(() => {
  if (!props.siteUrl) return null;
  try {
    return new URL(props.siteUrl).origin;
  } catch {
    return null;
  }
});
const src = computed(() => (origin.value ? `${origin.value}${CANVAS_PATH}` : ''));

const { connected, paletteDrag } = useDesignCanvas({
  iframe,
  origin: () => origin.value,
  payload: () => props.payload,
  highlight: () => props.highlight,
  breakpoint: () => breakpoint.value,
  scheme: () => scheme.value,
  readOnly: () => props.readOnly,
  on: {
    selectNode: ({ node }) => emit('selectNode', node),
    hoverNode: ({ node }) => emit('hoverNode', node),
    moveNode: ({ node, parent, index }) => emit('moveNode', node, parent, index),
    insertNode: ({ parent, index, element }) => emit('insertNode', parent, index, element),
    removeNode: ({ node }) => emit('removeNode', node),
    editText: ({ node, text, locale, field }) => emit('editText', node, text, locale, field),
    resizeNode: ({ node, width, height }) => {
      const size: { width?: number; height?: number } = {};
      if (typeof width === 'number') size.width = width;
      if (typeof height === 'number') size.height = height;
      emit('resizeNode', node, size);
    },
  },
});

const SCHEME_OPTIONS = [
  { value: 'light' as const, label: 'Light mode', icon: 'sun' },
  { value: 'dark' as const, label: 'Dark mode', icon: 'moon' },
];
/** The stylesheet has dark colors only when the theme defines some. */
const hasDark = computed(() => props.payload?.css.includes('[data-mb-scheme=dark]') ?? false);

const deviceOptions = BREAKPOINTS.map((entry) => ({
  value: entry.value,
  label: entry.label,
  icon: entry.icon,
  hint: entry.width ? `${entry.width}px` : 'Full width',
}));

/** `0` fits the frame to the canvas. */
const zoom = ref(0);
const ZOOM_OPTIONS = [
  { value: 0, label: 'Fit' },
  { value: 50, label: '50%' },
  { value: 75, label: '75%' },
  { value: 100, label: '100%' },
];

const box = ref<HTMLElement | null>(null);
const size = ref({ width: 0, height: 0 });
let observer: ResizeObserver | null = null;
watch(
  box,
  (element) => {
    observer?.disconnect();
    observer = null;
    if (!element) return;
    observer = new ResizeObserver(([entry]) => {
      if (entry) size.value = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(element);
  },
  { immediate: true, flush: 'post' },
);
onScopeDispose(() => observer?.disconnect());

/*
 * Browsers deliver no drag events into a frame on another origin, so while a palette
 * element is dragged a layer over the frame takes the drag and relays it to the canvas.
 */
const paletteDragging = ref(false);
const onWindowDragStart = (event: DragEvent) => {
  paletteDragging.value = [...(event.dataTransfer?.types ?? [])].includes(PALETTE_TYPE);
};
const onWindowDragEnd = () => {
  paletteDragging.value = false;
};
// Bubbling: the palette sets the drag's types in its own handler first.
window.addEventListener('dragstart', onWindowDragStart);
window.addEventListener('dragend', onWindowDragEnd, true);
onScopeDispose(() => {
  window.removeEventListener('dragstart', onWindowDragStart);
  window.removeEventListener('dragend', onWindowDragEnd, true);
});

/** Canvas coordinates of a pointer over the scaled frame. */
function canvasPoint(event: DragEvent): { x: number; y: number } | null {
  const rect = iframe.value?.getBoundingClientRect();
  if (!rect) return null;
  return {
    x: (event.clientX - rect.left) / scale.value,
    y: (event.clientY - rect.top) / scale.value,
  };
}

function onLayerDragOver(event: DragEvent) {
  const kind = paletteDragKind([...(event.dataTransfer?.types ?? [])]);
  const point = canvasPoint(event);
  if (!kind || !point) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  paletteDrag('over', kind, point.x, point.y);
}

function onLayerDragLeave(event: DragEvent) {
  const kind = paletteDragKind([...(event.dataTransfer?.types ?? [])]);
  if (kind) paletteDrag('leave', kind, 0, 0);
}

function onLayerDrop(event: DragEvent) {
  const kind = event.dataTransfer?.getData(PALETTE_TYPE) ?? '';
  const point = canvasPoint(event);
  paletteDragging.value = false;
  if (!kind || !point) return;
  event.preventDefault();
  paletteDrag('drop', kind, point.x, point.y);
}

/** Desktop renders at least this wide. */
const DESKTOP_MIN = 1280;
const frameWidth = computed(
  () =>
    BREAKPOINTS.find((entry) => entry.value === breakpoint.value)?.width ??
    Math.max(DESKTOP_MIN, Math.round(size.value.width)),
);
const scale = computed(() => {
  if (zoom.value) return zoom.value / 100;
  return size.value.width ? Math.min(1, size.value.width / frameWidth.value) : 1;
});
const frameStyle = computed(() => ({
  width: `${frameWidth.value}px`,
  height: `${Math.max(size.value.height, 200) / scale.value}px`,
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left',
}));
const frameBoxStyle = computed(() => ({
  width: `${frameWidth.value * scale.value}px`,
  height: `${Math.max(size.value.height, 200)}px`,
}));
</script>

<template>
  <div
    class="ws:flex ws:h-full ws:min-h-0 ws:flex-col ws:overflow-hidden ws:bg-surface-100 ws:dark:bg-surface-950"
    :class="flush ? '' : 'ws:rounded-card ws:border ws:border-surface-200 ws:dark:border-surface-800'"
  >
    <div class="ws:flex ws:shrink-0 ws:flex-wrap ws:items-center ws:gap-2 ws:border-b ws:border-surface-200 ws:bg-surface-0 ws:px-3 ws:py-1.5 ws:dark:border-surface-800 ws:dark:bg-surface-900">
      <span
        class="ws:flex ws:shrink-0 ws:items-center ws:gap-1.5 ws:text-2xs ws:text-surface-500"
        :title="connected ? 'The preview is live: changes show up as you make them' : undefined"
      >
        <span class="ws:inline-block ws:h-1.5 ws:w-1.5 ws:shrink-0 ws:rounded-pill" :class="connected ? 'ws:bg-ok-500' : 'ws:animate-pulse ws:bg-warn-500'" />
        <span :class="connected ? 'ws:sr-only' : ''">{{ connected ? 'Canvas connected' : siteUrl ? 'Loading the preview...' : 'No site address' }}</span>
      </span>
      <div class="ws:flex ws:min-w-0 ws:flex-1 ws:flex-wrap ws:items-center ws:gap-2"><slot name="tools" /></div>
      <SegmentedControl v-model="breakpoint" :options="deviceOptions" aria-label="Breakpoint" icon-only />
      <SegmentedControl
        v-model="scheme"
        :options="SCHEME_OPTIONS"
        aria-label="Color scheme"
        icon-only
        :disabled="!hasDark"
        :title="hasDark ? undefined : 'The theme has no dark colors yet; add them under Design, Theme.'"
      />
      <Select v-model="zoom" :options="ZOOM_OPTIONS" variant="sm" class="ws:!w-24" aria-label="Zoom" />
      <span class="ws:hidden ws:w-20 ws:text-right ws:text-2xs ws:text-surface-500 ws:tabular-nums ws:sm:inline">{{ frameWidth }}px</span>
    </div>
    <div ref="box" class="ws:min-h-0 ws:flex-1 ws:overflow-auto ws:p-3">
      <div v-if="src" class="ws:relative ws:mx-auto ws:overflow-hidden ws:rounded-control ws:border ws:border-surface-300 ws:bg-white ws:shadow-pop ws:transition-[width] ws:duration-[var(--ws-mb-dur-slow)] ws:dark:border-surface-700" :style="frameBoxStyle">
        <iframe
          ref="iframe"
          :src="src"
          class="ws:absolute ws:top-0 ws:left-0 ws:border-0 ws:bg-white"
          :style="frameStyle"
          sandbox="allow-scripts allow-same-origin"
          :title="title"
          :aria-label="title"
        />
        <div
          v-if="paletteDragging && connected && !readOnly"
          class="ws:absolute ws:inset-0"
          data-testid="canvas-drop-layer"
          @dragover="onLayerDragOver"
          @dragleave="onLayerDragLeave"
          @drop="onLayerDrop"
        />
      </div>
      <div v-else class="ws:flex ws:h-full ws:flex-col ws:items-center ws:justify-center ws:gap-2 ws:p-6 ws:text-center ws:text-sm ws:text-surface-500">
        <Icon name="monitor" class="mb-icon-lg" />
        <p class="ws:max-w-sm">
          The admin does not know where the site runs yet. Set <code>server.siteUrl</code> (or <code>SITE_URL</code>) in the management API's config to the site process address, then reload.
        </p>
      </div>
    </div>
  </div>
</template>
