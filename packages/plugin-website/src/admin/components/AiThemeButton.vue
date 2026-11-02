<script setup lang="ts">
import { FeatureGate, Icon, usePluginApi } from '@manablox/admin-sdk';
import type { ThemeDesign } from '@manablox/site';
import { ref } from 'vue';
import type { AiAdminApi } from '../model/ai-api';
import AiThemeDialog from './AiThemeDialog.vue';

/** Opens the AI theme dialog; shown only with the AI plugin, a text provider and `ai:use`. */
defineProps<{ spaceId: string; theme: ThemeDesign }>();
const emit = defineEmits<{ apply: [theme: ThemeDesign] }>();
const ai = usePluginApi<AiAdminApi>('ai');
const wand = ai?.useWand('text');
const open = ref(false);
</script>

<template>
  <!-- Locked while AI is, and while designing with AI is. -->
  <FeatureGate v-if="ai && wand?.enabled.value" :feature="ai.features.ai" label="Design with AI" trigger-class="mb-btn-outline">
    <FeatureGate :feature="ai.features.designModels" label="Design with AI" trigger-class="mb-btn-outline">
      <button type="button" class="mb-btn-outline" title="Propose colors, fonts and type from a description or a brand color" @click="open = true">
        <Icon name="wand" /> Design with AI
      </button>
    </FeatureGate>
  </FeatureGate>
  <AiThemeDialog
    v-if="open && ai && wand"
    :ai="ai"
    :space-id="spaceId"
    :theme="theme"
    @apply="emit('apply', $event)"
    @close="open = false"
  />
</template>
