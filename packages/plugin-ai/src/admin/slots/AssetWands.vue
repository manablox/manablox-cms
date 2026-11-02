<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import AiWandButton from '../components/AiWandButton.vue';

/** "Generate an image" and "Generate a video" in the asset library; `added` selects the result. */
const props = defineProps<AdminSlotProps['assets.actions']>();
</script>

<template>
  <AiWandButton capability="image" variant="button" label="Generate an image" @asset="props.added" />
  <AiWandButton capability="video" variant="button" label="Generate a video" @asset="props.added" />
</template>
