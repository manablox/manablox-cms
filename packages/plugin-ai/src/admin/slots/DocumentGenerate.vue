<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { FeatureGate, Icon, useCan } from '@manablox/admin-sdk';
import AiGenerateDialog from '../components/AiGenerateDialog.vue';
import { AI_FEATURE } from '../model/features';
import { useDocumentGeneration } from '../useDocumentGeneration';

/** "Generate" in the document editor: writes the whole document with AI; a lock while AI is locked. */
const props = defineProps<AdminSlotProps['content.editor.actions']>();

const canWrite = useCan('content:write', () => props.type.id);
const generation = useDocumentGeneration({
  document: () => props.document,
  contentType: () => props.type,
  canWrite: () => canWrite.value,
});
</script>

<template>
  <FeatureGate
    v-if="generation.canGenerate.value"
    :feature="AI_FEATURE"
    label="Generate"
    trigger-class="mb-btn-ghost ai:text-brand-600 ai:dark:text-brand-300"
  >
    <button
      class="mb-btn-ghost ai:text-brand-600 ai:dark:text-brand-300"
      title="Write this document with AI"
      @click="generation.generating.value = true"
    >
      <Icon name="wand" /> Generate
    </button>
  </FeatureGate>
  <AiGenerateDialog
    v-if="generation.generating.value"
    :space-id="document.spaceId"
    capability="document"
    :content-type-id="type.id"
    :locale="document.locale"
    :provider-kinds="generation.wand.kinds.value"
    :title="`Write this ${type.label.toLowerCase()}`"
    @close="generation.generating.value = false"
    @fields="generation.apply"
  />
</template>
