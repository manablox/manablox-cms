<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import type { AssetCrop } from '@manablox/core';

/** The image editor's crop controls: the ratio lock, the crop in pixels and "Whole image". */
defineProps<{
  ratios: Array<{ id: string; label: string }>;
  crop: AssetCrop;
  isWholeImage: boolean;
}>();

const ratioId = defineModel<string>('ratioId', { required: true });

const emit = defineEmits<{ ratio: [id: string]; reset: [] }>();
</script>

<template>
  <div>
    <p class="mb-label flex items-center gap-1.5"><Icon name="crop" class="mb-icon-sm" /> Crop</p>
    <SegmentedControl
      v-model="ratioId"
      :options="ratios.map((option) => ({ value: option.id, label: option.label }))"
      :columns="3"
      aria-label="Crop ratio"
      @select="emit('ratio', $event)"
    />
    <p class="mt-2 font-mono mb-meta tabular-nums">
      {{ crop.width }} x {{ crop.height }} at {{ crop.left }}, {{ crop.top }}
    </p>
    <button type="button" class="mb-btn-ghost mb-btn-sm mt-1" :disabled="isWholeImage" @click="emit('reset')">
      <Icon name="reset" class="mb-icon-sm" /> Whole image
    </button>
  </div>
</template>
