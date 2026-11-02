<script setup lang="ts">
import { shortcutHint, TextareaField } from '@manablox/admin-sdk';
import type { WorkflowCreateActionProps } from '@manablox/plugin-workflows/admin-slots';
import AiProviderSelect from '../components/AiProviderSelect.vue';
import DesignButton from '../components/DesignButton.vue';
import { useDesignRun } from '../useDesignRun';
import { useWand } from '../useWand';

/**
 * "Describe it" in the new workflow dialog: a model designs the workflow from a description;
 * the dialog shows the design for review before it is created.
 */
const props = defineProps<WorkflowCreateActionProps>();

const wand = useWand('text');
// The dialog shows the design; the run only reports failures.
const run = useDesignRun((input) => props.design(input));
const { provider, prompt: description, busy: designing, note } = run;
</script>

<template>
  <p v-if="!wand.enabled.value" class="mb-callout" role="status">
    Add an AI provider that writes text in Settings, AI to describe workflows here.
  </p>
  <template v-else>
    <AiProviderSelect v-model="provider" :space-id="spaceId" :refs="wand.kinds.value" />
    <TextareaField
      v-model="description"
      label="What should happen?"
      class="ai:min-h-28"
      placeholder="When an article is published, have AI write a two-sentence summary for social media and mail it to the editors. If the article is in the News category, also post it to our Slack webhook."
      maxlength="12000"
      hint="Name the trigger, the steps and where anything goes. It is built from this space's actions, credentials and triggers, and created as an unpublished draft."
      @keydown.meta.enter.prevent="run.run()"
      @keydown.ctrl.enter.prevent="run.run()"
    />
    <div class="ai:flex ai:justify-end">
      <DesignButton
        :busy="designing"
        :disabled="!run.ready.value"
        :label="designing ? 'Designing...' : designed ? 'Design again' : 'Design'"
        :title="shortcutHint('mod+enter', designed ? 'Design it again' : 'Design it')"
        @click="run.run()"
      />
    </div>
    <p v-if="note" class="mb-callout" role="status">{{ note }}</p>
  </template>
</template>
