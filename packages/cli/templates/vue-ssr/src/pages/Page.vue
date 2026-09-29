<script setup lang="ts">
import { blocksOf, type ContentNode } from '@manablox/public-sdk';
import { computed, useSSRContext, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import Blocks from '../components/Blocks.vue';
import { contentRenderers } from '../components/content/index.js';
import { useLoad } from '../composables/useLoad.js';
import { useManablox } from '../lib/manablox.js';

/**
 * The catch-all route: the CMS resolves the current path to a document. `pnpm types`
 * writes `src/manablox.d.ts` from the space's content model; typing `byPermalink` with
 * the generated `Page` turns a renamed field into a compile error rather than
 * `undefined` in production.
 */
const route = useRoute();
const cms = useManablox();
const ssr = import.meta.env.SSR ? useSSRContext<{ status?: number; title?: string }>() : undefined;

const {
  data: page,
  error,
  pending,
} = useLoad(
  () => `page:${route.path}`,
  async () => {
    // The SDK strips the slashes; the empty path left for `/` resolves the space's home
    // page, the document starred in the content tree.
    // `expand` inlines the relations the components show, which would otherwise be ids.
    const found = await cms.byPermalink<ContentNode>(route.path, { expand: __EXPAND__ });
    if (!found && ssr) ssr.status = 404;
    if (found && ssr) ssr.title = found.title;
    return found;
  },
);

const fields = computed(() => page.value?.fields ?? {});
const blocks = computed(() => blocksOf(fields.value.components));
// A content type with a component of its own renders through it; any other as the
// generic article in the template.
const content = computed(() => (page.value ? contentRenderers[page.value.type] : undefined));

if (!import.meta.env.SSR) {
  watchEffect(() => {
    if (page.value) document.title = page.value.title;
  });
}
</script>

<template>
  <div v-if="error" class="state">
    <h1>Something went wrong</h1>
    <p>{{ error instanceof Error ? error.message : String(error) }}</p>
  </div>
  <div v-else-if="!page && !pending" class="state">
    <h1>Not found</h1>
    <p>Nothing is published at {{ route.path }}.</p>
    <p><RouterLink to="/">Back to the start</RouterLink></p>
  </div>
  <component :is="content" v-else-if="page && content" :node="page" />
  <article v-else-if="page">
    <h1>{{ page.title }}</h1>
    <p v-if="typeof fields.summary === 'string' && fields.summary" class="lead">
      {{ fields.summary }}
    </p>
    <Blocks :blocks="blocks" :path="['components']" :value="fields.components" />
  </article>
</template>
