<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { Icon } from '@manablox/admin-sdk';
import { designRoute } from '../model/status';

/** Block and page types link to their design. */
const props = defineProps<AdminSlotProps['contentType.actions']>();
</script>

<template>
  <RouterLink v-if="props.type.kind === 'block'" :to="designRoute('block', props.type.id) ?? '/design/blocks'" class="mb-btn-ghost" title="How this block looks on the designed site">
    <Icon name="palette" /> Design
  </RouterLink>
  <RouterLink v-else-if="props.type.kind === 'content'" :to="designRoute('page', props.type.id) ?? '/design/pages'" class="mb-btn-ghost" title="How pages of this type look on the designed site">
    <Icon name="palette" /> Design
  </RouterLink>
</template>
