<script setup lang="ts">
import { type ContentTypeSummary, FieldRenderer, Icon } from '@manablox/admin-sdk';
import type { BlocksValue } from '@manablox/core';
import { computed } from 'vue';
import type { GeneratedImage, RepeaterItem } from '../model/document';

/** A generated document: its text fields, its blocks and repeater items to edit, its picture briefs. */
const props = defineProps<{
  fields: Record<string, string> | null;
  documentType: ContentTypeSummary | null;
  images: GeneratedImage[];
  /** Pictures are being drawn. */
  drawing: boolean;
  /** The space has a provider that can draw the pictures. */
  hasImageProvider: boolean;
}>();

/** Generated blocks per field, edited in place by the preview's real block field. */
const blocks = defineModel<Record<string, BlocksValue>>('blocks', { required: true });
/** Generated repeater items per field, edited in place like the blocks. */
const items = defineModel<Record<string, RepeaterItem[]>>('items', { required: true });

/** Generated block and repeater fields, in declaration order. */
const blockFields = computed(() =>
  (props.documentType?.fields ?? []).filter((field) => field.name in blocks.value),
);
const itemFields = computed(() =>
  (props.documentType?.fields ?? []).filter((field) => field.name in items.value),
);
</script>

<template>
  <div v-if="fields" class="ai:space-y-2">
    <p class="mb-label">Result</p>
    <dl class="mb-list-divided ai:rounded-card ai:border ai:border-surface-200 ai:dark:border-surface-800">
      <div v-for="(value, name) in fields" :key="name" class="ai:p-3">
        <dt class="ai:font-mono mb-meta">{{ name }}</dt>
        <dd class="ai:mt-1 ai:line-clamp-4 ai:text-sm">{{ value }}</dd>
      </div>
    </dl>
    <p class="mb-hint">Using it replaces what those fields hold now. Nothing is saved until you save.</p>
  </div>

  <!-- Generated blocks, editable in the real block field. -->
  <div v-for="field in blockFields" :key="field.id" class="ai:space-y-1">
    <FieldRenderer
      :field="field"
      :model-value="blocks[field.name]"
      :path="['ai', field.name]"
      @update:model-value="blocks[field.name] = $event as BlocksValue"
    />
    <p class="mb-hint">
      Drag a block to move it, drop it on the board to place it, open it to rewrite it.
      Nothing here touches the document until you use it.
    </p>
  </div>

  <!-- Generated repeater items, editable in the real repeater field. -->
  <div v-for="field in itemFields" :key="field.id" class="ai:space-y-1">
    <FieldRenderer
      :field="field"
      :model-value="items[field.name]"
      :path="['ai', field.name]"
      @update:model-value="items[field.name] = $event as RepeaterItem[]"
    />
    <p class="mb-hint">Open an item to rewrite it. Its other fields stay empty until you fill them.</p>
  </div>

  <!-- Picture briefs from the text model, drawn in a second pass. -->
  <div v-if="images.length" class="ai:space-y-2">
    <p class="mb-label">
      Pictures
      <span class="ai:font-normal ai:text-surface-500">
        - {{ images.filter((image) => image.assetId).length }} of {{ images.length }} drawn
      </span>
    </p>
    <ul class="ai:grid ai:gap-2 ai:sm:grid-cols-2">
      <li
        v-for="(image, index) in images"
        :key="`${image.field}-${image.blockId ?? ''}-${index}`"
        class="ai:flex ai:gap-3 ai:rounded-card ai:border ai:border-surface-200 ai:p-2 ai:dark:border-surface-800"
      >
        <img
          v-if="image.url"
          :src="image.url"
          alt=""
          class="ai:h-16 ai:w-16 ai:shrink-0 ai:rounded-control ai:object-cover"
        />
        <div
          v-else
          class="ai:flex ai:h-16 ai:w-16 ai:shrink-0 ai:items-center ai:justify-center ai:rounded-control ai:bg-surface-100 ai:text-surface-400 ai:dark:bg-surface-800"
        >
          <Icon v-if="drawing" name="spinner" class="mb-icon ai:animate-spin" />
          <Icon v-else name="image" />
        </div>
        <div class="ai:min-w-0">
          <p class="ai:truncate ai:text-xs ai:font-semibold">{{ image.label }}</p>
          <p class="ai:line-clamp-3 mb-meta">{{ image.prompt }}</p>
        </div>
      </li>
    </ul>
    <p v-if="!hasImageProvider" class="mb-hint">
      No provider in this space can draw them. The text is usable without them.
    </p>
  </div>
</template>
