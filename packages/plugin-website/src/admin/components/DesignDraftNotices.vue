<script setup lang="ts">
import type { DesignDraftState } from '../useDesignDraft';

/** Callouts for a design saved elsewhere, a refused save and its issues. */
const props = defineProps<{ draft: DesignDraftState; what: string }>();

const pathOf = (path: (string | number)[] | undefined) =>
  (path ?? []).filter((segment) => segment !== 'draft').join('.');

function reload() {
  void props.draft.reload();
}
</script>

<template>
  <div v-if="draft.conflict.value" class="mb-callout ws:mb-4" role="alert">
    Someone else saved {{ what }} while you were editing<template v-if="draft.conflict.value.actual !== null">
      (your version {{ draft.conflict.value.expected }}, current {{ draft.conflict.value.actual }})</template>, so your changes were not saved.
    <button type="button" class="ws:ml-2 ws:underline" @click="reload">Discard my changes and reload</button>
  </div>
  <div v-else-if="draft.changedElsewhere.value" class="mb-callout ws:mb-4" role="status">
    Someone else saved {{ what }} just now; saving yours would be refused.
    <button type="button" class="ws:ml-2 ws:underline" @click="reload">Discard my changes and reload</button>
  </div>
  <div v-if="draft.saveError.value" class="mb-callout ws:mb-4" role="alert">
    <p>{{ draft.saveError.value }}</p>
    <ul v-if="draft.issues.value.length" class="ws:mt-1 ws:list-disc ws:pl-5 ws:text-xs">
      <li v-for="(issue, index) in draft.issues.value.slice(0, 8)" :key="index">
        <span class="ws:font-mono">{{ pathOf(issue.path) }}</span> {{ issue.params?.message }}
      </li>
    </ul>
  </div>
</template>
