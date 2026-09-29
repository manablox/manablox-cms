<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import type { FocalPoint } from '@manablox/core';

/** The image editor's focal point readout and "Centre". */
defineProps<{ focal: FocalPoint; hasFocal: boolean }>();

const emit = defineEmits<{ reset: [] }>();
</script>

<template>
  <div>
    <p class="mb-label flex items-center gap-1.5"><Icon name="crosshair" class="mb-icon-sm" /> Focal point</p>
    <p class="font-mono mb-meta tabular-nums">
      {{ hasFocal ? `${Math.round(focal.x * 100)}% , ${Math.round(focal.y * 100)}%` : 'centred' }}
    </p>
    <button type="button" class="mb-btn-ghost mb-btn-sm mt-1" :disabled="!hasFocal" @click="emit('reset')">
      <Icon name="reset" class="mb-icon-sm" /> Centre
    </button>
  </div>
</template>
