<script setup lang="ts">
import FormDialog from '@manablox/admin-sdk/components/ui/FormDialog.vue';
import { ref, useTemplateRef } from 'vue';
import SpaceImportForm, { type SpaceImportOutcome } from './SpaceImportForm.vue';

/** The space import in a dialog; an import that had to adapt shows its notes before closing. */
const emit = defineEmits<{ close: []; imported: [summary: string] }>();
const form = useTemplateRef('form');
const outcome = ref<SpaceImportOutcome | null>(null);

function onImported(result: SpaceImportOutcome) {
  outcome.value = result;
  emit('imported', result.summary);
}

/** Closes after an import without notes; with notes, after they are read. */
async function submit(): Promise<boolean> {
  if (outcome.value) return true;
  const done = (await form.value?.submit()) ?? false;
  // Set by `onImported` during the await.
  const result = outcome.value as SpaceImportOutcome | null;
  return done && !result?.notes.length;
}
</script>

<template>
  <FormDialog
    title="Import a space"
    :submit-label="outcome ? 'Done' : 'Import space'"
    busy-label="Importing..."
    :busy="form?.busy ?? false"
    :disabled="!outcome && !form?.ready"
    :on-submit="submit"
    @close="emit('close')"
  >
    <div v-if="outcome" class="space-y-3" role="status">
      <p class="text-sm">{{ outcome.summary }}</p>
      <div class="mb-callout">
        <p class="font-medium">The import changed a few things to fit:</p>
        <ul class="mt-1 list-disc space-y-1 pl-5 text-sm">
          <li v-for="(note, index) in outcome.notes" :key="index">{{ note }}</li>
        </ul>
      </div>
    </div>
    <SpaceImportForm v-else ref="form" embedded @imported="onImported" />
  </FormDialog>
</template>
