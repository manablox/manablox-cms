<script setup lang="ts">
import { useDraftStore } from '~/features/content/useDraftStore';

/** Callouts for a document saved or deleted elsewhere while it is open here. */
const draft = useDraftStore();
</script>

<template>
  <div v-if="draft.changedElsewhere && !draft.conflict" class="mb-callout mx-6 mt-4" role="status">
    <template v-if="draft.changedElsewhere.action === 'content.delete'">
      {{ draft.changedElsewhere.by }} deleted this document just now.
    </template>
    <template v-else>
      {{ draft.changedElsewhere.by }} saved this document just now; saving your version would be refused.
      <button class="ml-2 underline" @click="draft.reload()">Discard my changes and reload</button>
    </template>
  </div>

  <div v-if="draft.conflict" class="mb-callout mx-6 mt-4" role="alert">
    Someone else saved this document while you were editing
    (your version {{ draft.conflict.expected }}, current {{ draft.conflict.actual }}).
    <button class="ml-2 underline" @click="draft.reload()">Discard my changes and reload</button>
  </div>
</template>
