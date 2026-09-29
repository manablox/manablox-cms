<script setup lang="ts">
import { connectPreview, fieldAttribute, type PreviewDocument } from '@manablox/live-preview';
import { blocksOf, normaliseFields } from '@manablox/public-sdk';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Blocks from '../components/Blocks.vue';
import { contentRenderers } from '../components/content/index.js';
import { useState } from '../lib/state.js';

/**
 * The visual editor's canvas. It renders in the browser only, because the document
 * arrives over the channel after the page has loaded, and needs no API key: nothing here
 * fetches a draft.
 */
const { config } = useState();
const document = ref<PreviewDocument | null>(null);
const highlighted = ref<string | null>(null);
let disconnect: (() => void) | undefined;

onMounted(() => {
  disconnect = connectPreview({
    // The origin check is not optional: without it any page could drive the preview.
    editorOrigin: config.editorOrigin,
    clickToEdit: true,
    onDocument: (next) => {
      document.value = next;
    },
    onHighlight: (path) => {
      highlighted.value = path ? path.join('.') : null;
    },
  });
});
onBeforeUnmount(() => disconnect?.());

// The editor sends fields in storage shape; normalising them gives the shape the SDK
// returns, so the same <Blocks> and <Teaser> render the preview and the live page.
const fields = computed(() => (document.value ? normaliseFields(document.value.fields) : {}));
const blocks = computed(() => blocksOf(fields.value.components));
const content = computed(() =>
  document.value ? contentRenderers[document.value.typeName] : undefined,
);
</script>

<template>
  <div :data-manablox-highlight="highlighted">
    <component
      :is="content"
      v-if="document && content"
      :node="{ title: document.title, fields }"
    />
    <article v-else-if="document">
      <h1 v-bind="fieldAttribute(['title'])">{{ document.title || 'Untitled' }}</h1>
      <p
        v-if="typeof fields.summary === 'string' && fields.summary"
        class="lead"
        v-bind="fieldAttribute(['summary'])"
      >
        {{ fields.summary }}
      </p>
      <Blocks :blocks="blocks" :path="['components']" :value="fields.components" />
    </article>
    <p v-else class="state">Waiting for the editor...</p>
  </div>
</template>
