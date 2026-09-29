<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';

/** The image editor's quarter turns and mirrors, as they look on screen. */
defineProps<{
  rotate: number;
  mirroredHorizontally: boolean;
  mirroredVertically: boolean;
}>();

const emit = defineEmits<{ turn: [quarters: 1 | -1]; mirror: [axis: 'x' | 'y'] }>();
</script>

<template>
  <div>
    <p class="mb-label flex items-center gap-1.5"><Icon name="rotate-cw" class="mb-icon-sm" /> Orientation</p>
    <div class="flex flex-wrap gap-1">
      <button type="button" class="mb-btn-outline mb-btn-sm" title="Turn a quarter left" aria-label="Turn a quarter left" @click="emit('turn', -1)">
        <Icon name="rotate-ccw" class="mb-icon-sm" />
      </button>
      <button type="button" class="mb-btn-outline mb-btn-sm" title="Turn a quarter right" aria-label="Turn a quarter right" @click="emit('turn', 1)">
        <Icon name="rotate-cw" class="mb-icon-sm" />
      </button>
      <button
        type="button"
        class="mb-btn-outline mb-btn-sm"
        :aria-pressed="mirroredHorizontally"
        title="Mirror left to right"
        aria-label="Mirror left to right"
        @click="emit('mirror', 'x')"
      >
        <Icon name="flip-horizontal" class="mb-icon-sm" />
      </button>
      <button
        type="button"
        class="mb-btn-outline mb-btn-sm"
        :aria-pressed="mirroredVertically"
        title="Mirror top to bottom"
        aria-label="Mirror top to bottom"
        @click="emit('mirror', 'y')"
      >
        <Icon name="flip-vertical" class="mb-icon-sm" />
      </button>
    </div>
    <p class="mt-1 font-mono mb-meta tabular-nums">
      {{ rotate }}&deg;{{ mirroredHorizontally ? ' mirrored' : '' }}{{ mirroredVertically ? ' flipped' : '' }}
    </p>
  </div>
</template>
