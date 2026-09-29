<script setup lang="ts">
import { FormDialog, TextareaField } from '@manablox/admin-sdk';
import { ref } from 'vue';

/** Asks for an optional note before publishing the draft as the next version. */
defineProps<{
  /** The number the new version gets. */
  version: number;
  enabled: boolean;
  /** The draft has unsaved edits, which are saved first. */
  unsaved: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ publish: [note: string | null]; close: [] }>();

const note = ref('');

function submit() {
  emit('publish', note.value.trim() || null);
}
</script>

<template>
  <FormDialog
    :title="`Publish version ${version}`"
    form-class="wf:space-y-3"
    submit-label="Publish"
    busy-label="Publishing..."
    :busy="busy"
    @submit="submit"
    @close="emit('close')"
  >
    <p class="wf:text-sm wf:text-surface-600 wf:dark:text-surface-400">
      From now on the trigger runs this version. Runs already under way finish on the version they started on.
      <template v-if="unsaved"> Your unsaved changes are saved first.</template>
    </p>
    <p v-if="!enabled" class="mb-callout wf:text-xs">
      The workflow is switched off, so nothing runs until you switch it on.
    </p>
    <TextareaField
      id="workflow-publish-note"
      v-model="note"
      label="What changed (optional)"
      rows="3"
      maxlength="500"
      placeholder="For example: only runs for published pages now"
    />
  </FormDialog>
</template>
