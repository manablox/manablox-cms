<script setup lang="ts">
import { FeatureGate, Icon, useCan, useSpaceStore } from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import AiTemplateDesignDialog from '../components/AiTemplateDesignDialog.vue';
import { AI_DESIGN_MODELS, AI_FEATURE } from '../model/features';
import { useWand } from '../useWand';

/** "Describe a template" on the template list. New block types need type rights; existing blocks do not. */
const spaces = useSpaceStore();
const canWrite = useCan('content:write', () => spaces.templateType?.id);
const wand = useWand('text');
const shown = computed(() => Boolean(spaces.templateType) && canWrite.value && wand.enabled.value);
const describing = ref(false);
</script>

<template>
  <!-- A lock while AI or designing with it is locked. -->
  <FeatureGate v-if="shown" :feature="AI_FEATURE" label="Describe a template" trigger-class="mb-btn-outline">
    <FeatureGate :feature="AI_DESIGN_MODELS" label="Describe a template" trigger-class="mb-btn-outline">
      <button type="button" class="mb-btn-outline" @click="describing = true">
        <Icon name="wand" /> Describe a template
      </button>
    </FeatureGate>
  </FeatureGate>
  <AiTemplateDesignDialog v-if="describing && spaces.currentId" :space-id="spaces.currentId" @close="describing = false" />
</template>
