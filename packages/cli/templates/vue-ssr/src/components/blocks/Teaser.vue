<script setup lang="ts">
import { fieldAttribute } from '@manablox/live-preview';
import {
  type Asset,
  assetSrcSet,
  assetUrl,
  type Block,
  isImage,
  isRichTextEmpty,
  richTextToHtml,
} from '@manablox/public-sdk';
import { computed } from 'vue';

/**
 * A `teaser` block. `data-manablox-field` is what makes click-to-edit work: the editor
 * reads it to map a click back to a field. Set through the helper, so the path cannot drift.
 */
const props = defineProps<{ block: Block; path: (string | number)[] }>();

const headline = computed(() =>
  typeof props.block.headline === 'string' ? props.block.headline : null,
);
// `v-html` below is safe only because `richTextToHtml` escapes every string and emits a
// fixed set of tags. Never pass a CMS string to `v-html` unescaped.
const body = computed(() =>
  isRichTextEmpty(props.block.body) ? null : richTextToHtml(props.block.body),
);
// A relation arrives as an id unless the page expanded it.
const image = computed(() =>
  isAsset(props.block.image) && isImage(props.block.image) ? props.block.image : null,
);

function isAsset(value: unknown): value is Asset {
  return typeof value === 'object' && value !== null && 'url' in value && 'mimeType' in value;
}
</script>

<template>
  <section class="teaser" v-bind="fieldAttribute(path)">
    <img
      v-if="image"
      :src="assetUrl(image, { preset: 'card' })"
      :srcset="assetSrcSet(image, { thumb: 320, card: 640, hero: 1920 })"
      sizes="(max-width: 46rem) 100vw, 46rem"
      :alt="image.alt ?? headline ?? ''"
      :width="image.width ?? undefined"
      :height="image.height ?? undefined"
      loading="lazy"
      decoding="async"
      v-bind="fieldAttribute([...path, 'image'])"
    />
    <h2 v-if="headline" v-bind="fieldAttribute([...path, 'headline'])">{{ headline }}</h2>
    <div v-if="body" v-bind="fieldAttribute([...path, 'body'])" v-html="body"></div>
  </section>
</template>
