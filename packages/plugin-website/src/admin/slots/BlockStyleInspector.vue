<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import BlockStyleSection from '../components/BlockStyleSection.vue';
import { withInstanceDesign } from '../model/block-style';
import { useSiteContext } from '../useSiteContext';

/** "Style this block" under a block's fields or beside the preview, on a designed site. */
const props = defineProps<AdminSlotProps['block.inspector']>();

const site = useSiteContext();
</script>

<template>
  <BlockStyleSection
    v-if="site.designed.value"
    :block="props.block"
    :read-only="props.readOnly"
    :collapsible="!props.panel"
    @update:design="props.update(withInstanceDesign(props.block, $event))"
  />
</template>
