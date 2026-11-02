<script setup lang="ts">
import type { ThemeDesign } from '@manablox/site';
import type { StyleEditor } from '../../model/style-visual';
import SpaceChip from './SpaceChip.vue';
import SpacingBox from './SpacingBox.vue';
import StyleRow from './StyleRow.vue';

/** Space inside the element, around it, and between its children. */
defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  readOnly: boolean;
}>();
</script>

<template>
  <div class="ws:space-y-4">
    <StyleRow
      label="Space inside and around"
      :names="['padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginX', 'marginY', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft']"
      :editor="editor"
      :read-only="readOnly"
      hint="Padding is space inside the element's edge, margin is space outside it. Click a number to change it."
    >
      <SpacingBox :editor="editor" :theme="theme" :read-only="readOnly" />
    </StyleRow>
    <StyleRow label="Gap between children" :names="['gap']" :editor="editor" :read-only="readOnly">
      <SpaceChip
        wide
        :model-value="editor.value('gap') as string | undefined"
        :inherited="editor.inherited('gap') as string | undefined"
        :theme="theme"
        label="Gap between children"
        :extra="['0']"
        :disabled="readOnly"
        @pick="(value) => editor.set('gap', value)"
      />
    </StyleRow>
  </div>
</template>
