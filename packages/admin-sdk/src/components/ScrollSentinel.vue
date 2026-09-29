<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

/** Emits `reach` when scrolled into view; re-arms when `disabled` turns false, chaining pages. */
const props = defineProps<{
  /** Nothing to load, or a load is in flight. */
  disabled?: boolean;
}>();
const emit = defineEmits<{ reach: [] }>();

const marker = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function arm() {
  observer?.disconnect();
  observer = null;
  if (props.disabled || !marker.value) return;
  // Absent in tests; no further pages load.
  if (typeof IntersectionObserver === 'undefined') return;

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) emit('reach');
    },
    // Prefetch slightly before the marker is visible.
    { rootMargin: '200px' },
  );
  observer.observe(marker.value);
}

onMounted(arm);
watch(() => props.disabled, arm);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div ref="marker" class="h-0" aria-hidden="true" />
</template>
