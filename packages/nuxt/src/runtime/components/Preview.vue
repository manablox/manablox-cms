<script setup lang="ts">
import { connectPreview, type PreviewDocument, type PreviewMeta } from '@manablox/live-preview';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useManabloxPreviewState, useRuntimeConfig } from '#imports';

/** Makes a `/preview` route the visual editor's canvas. */
const config = useRuntimeConfig().public.manablox as {
  preview: { enabled: boolean; editorOrigin: string };
};

const document = ref<PreviewDocument | null>(null);
/** Block labels, editable fields and grids. */
const meta = ref<PreviewMeta | null>(null);
const highlighted = ref<string | null>(null);
const shared = useManabloxPreviewState();
let disconnect: (() => void) | null = null;

onMounted(() => {
  if (!config.preview.enabled) return;
  const origin = config.preview.editorOrigin || window.location.origin;
  disconnect = connectPreview({
    editorOrigin: origin,
    clickToEdit: true,
    onDocument: (next, nextMeta) => {
      document.value = next;
      meta.value = nextMeta;
      shared.value = next;
    },
    onHighlight: (path) => {
      highlighted.value = path ? path.join('.') : null;
    },
  });
});

onBeforeUnmount(() => {
  disconnect?.();
  shared.value = null;
});

defineExpose({ document, meta });
</script>

<template>
  <div :data-manablox-highlight="highlighted">
    <slot v-if="document" :document="document" :fields="document.fields" :meta="meta" :grids="meta?.grids ?? {}" />
    <div v-else class="manablox-preview-idle">Waiting for the editor...</div>
  </div>
</template>

<style scoped>
.manablox-preview-idle {
  padding: 3rem;
  text-align: center;
  color: color-mix(in oklab, currentColor 55%, transparent);
  font: 500 0.875rem system-ui, sans-serif;
}
</style>
