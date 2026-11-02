<script setup lang="ts">
import { FeatureGate, Icon, useSpaceStore } from '@manablox/admin-sdk';
import { ref } from 'vue';
import AiTypeDesignDialog from '../components/AiTypeDesignDialog.vue';
import { AI_DESIGN_MODELS, AI_FEATURE } from '../model/features';
import { useWand } from '../useWand';

/** "Describe a content model" on the content type list, when the space has a writer. */
const spaces = useSpaceStore();
const wand = useWand('text');
const describing = ref(false);
</script>

<template>
  <!-- A lock while AI or designing with it is locked. -->
  <FeatureGate v-if="wand.enabled.value" :feature="AI_FEATURE" label="Describe a content model" trigger-class="mb-btn-outline">
    <FeatureGate :feature="AI_DESIGN_MODELS" label="Describe a content model" trigger-class="mb-btn-outline">
      <button type="button" class="mb-btn-outline" @click="describing = true">
        <Icon name="wand" /> Describe a content model
      </button>
    </FeatureGate>
  </FeatureGate>
  <AiTypeDesignDialog v-if="describing && spaces.currentId" :space-id="spaces.currentId" @close="describing = false" />
</template>
