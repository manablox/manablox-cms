<script setup lang="ts">
import { FeatureGate, Icon, usePluginApi } from '@manablox/admin-sdk';
import type { BlockDesign, ThemeDesign } from '@manablox/site';
import { ref } from 'vue';
import type { AiAdminApi } from '../model/ai-api';
import AiBlockDesignDialog from './AiBlockDesignDialog.vue';

/** Opens the AI block design dialog; shown only with the AI plugin, a text provider and `ai:use`. */
defineProps<{
  spaceId: string;
  typeId: string;
  design: BlockDesign;
  variant: string;
  theme: ThemeDesign;
  siteUrl: string | null;
  locale: string;
}>();
const emit = defineEmits<{ apply: [design: BlockDesign, variant: string] }>();
const ai = usePluginApi<AiAdminApi>('ai');
const wand = ai?.useWand('text');
const open = ref(false);
</script>

<template>
  <!-- Locked while AI is, and while designing with AI is. -->
  <FeatureGate v-if="ai && wand?.enabled.value" :feature="ai.features.ai" label="Design with AI" trigger-class="mb-btn-ghost">
    <FeatureGate :feature="ai.features.designModels" label="Design with AI" trigger-class="mb-btn-ghost">
      <button type="button" class="mb-btn-ghost" title="Propose a design for this block from a description" @click="open = true">
        <Icon name="wand" /> Design with AI
      </button>
    </FeatureGate>
  </FeatureGate>
  <AiBlockDesignDialog
    v-if="open && ai && wand"
    :ai="ai"
    :space-id="spaceId"
    :type-id="typeId"
    :design="design"
    :variant="variant"
    :theme="theme"
    :site-url="siteUrl"
    :locale="locale"
    @apply="(next, name) => emit('apply', next, name)"
    @close="open = false"
  />
</template>
