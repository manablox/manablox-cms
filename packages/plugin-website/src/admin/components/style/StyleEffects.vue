<script setup lang="ts">
import type { StylePropName } from '@manablox/site';
import { computed } from 'vue';
import type { StyleEditor } from '../../model/style-visual';
import ChoiceTiles from './ChoiceTiles.vue';
import StyleRow from './StyleRow.vue';

/** See-through, clipping, and how a picture fills its frame. */
const props = defineProps<{
  editor: StyleEditor;
  advanced: boolean;
  readOnly: boolean;
}>();

const read = (prop: StylePropName) => props.editor.value(prop) as string | undefined;
const inheritedOf = (prop: StylePropName) => props.editor.inherited(prop) as string | undefined;

const opacity = computed(() => props.editor.value('opacity') as number | undefined);
const shownOpacity = computed(
  () => opacity.value ?? (props.editor.inherited('opacity') as number | undefined) ?? 1,
);
/** The opacity slider in percent: shows the set or inherited opacity, sets it when moved. */
const opacityPercent = computed({
  get: () => Math.round(shownOpacity.value * 100),
  set: (percent: number) => props.editor.set('opacity', percent / 100),
});

const FIT = [
  { value: 'cover', label: 'Fill', title: 'Fills the frame, cropping the edges' },
  { value: 'contain', label: 'Fit', title: 'Shows the whole picture, with space around it' },
  { value: 'fill', label: 'Stretch', title: 'Stretches the picture to the frame' },
  { value: 'none', label: 'Original', title: 'Keeps its own size' },
];
const POSITION = [
  { value: 'top', label: 'Top', icon: 'up' },
  { value: 'left', label: 'Left', icon: 'arrow-left' },
  { value: 'center', label: 'Center', icon: 'crosshair' },
  { value: 'right', label: 'Right', icon: 'arrow-right' },
  { value: 'bottom', label: 'Bottom', icon: 'down' },
];
const OVERFLOW = [
  { value: 'visible', label: 'Show', title: 'Content may stick out' },
  { value: 'hidden', label: 'Cut off', title: 'Content outside is hidden' },
  { value: 'auto', label: 'Scroll', title: 'Scrolls when the content is bigger' },
];
</script>

<template>
  <div class="ws:space-y-4">
    <StyleRow label="Opacity" :names="['opacity']" :editor="editor" :read-only="readOnly">
      <div class="ws:flex ws:items-center ws:gap-3">
        <span
          class="ws:h-8 ws:w-8 ws:shrink-0 ws:rounded-control ws:border ws:border-surface-200 ws:bg-[repeating-conic-gradient(var(--ws-color-surface-200)_0_25%,transparent_0_50%)] ws:bg-[length:8px_8px] ws:dark:border-surface-700"
          aria-hidden="true"
        >
          <span class="ws:block ws:h-full ws:w-full ws:rounded-control ws:bg-brand-500" :style="{ opacity: shownOpacity }" />
        </span>
        <input
          type="range"
          class="mb-range ws:min-w-0 ws:flex-1"
          min="0"
          max="100"
          step="5"
          v-model.number="opacityPercent"
          :class="opacity === undefined ? 'ws:opacity-60' : ''"
          aria-label="Opacity"
          :disabled="readOnly"
        />
        <span class="ws:w-10 ws:shrink-0 ws:text-right ws:font-mono ws:text-xs ws:tabular-nums">{{ Math.round(shownOpacity * 100) }}%</span>
      </div>
    </StyleRow>

    <template v-if="advanced">
      <StyleRow label="Picture in its frame" :names="['objectFit']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('objectFit')"
          :inherited="inheritedOf('objectFit')"
          :options="FIT"
          :columns="4"
          labelled
          group-label="Picture in its frame"
          :disabled="readOnly"
          @update:model-value="editor.set('objectFit', $event)"
        >
          <template #tile="{ option, active }">
            <span class="ws:relative ws:flex ws:h-5 ws:w-8 ws:items-center ws:justify-center ws:overflow-hidden ws:rounded-[2px] ws:border" :class="active ? 'ws:border-brand-500' : 'ws:border-surface-400'">
              <span
                class="ws:block ws:rounded-pill"
                :class="[
                  active ? 'ws:bg-brand-400' : 'ws:bg-surface-400',
                  option.value === 'cover' ? 'ws:h-8 ws:w-8' : option.value === 'contain' ? 'ws:h-4 ws:w-4' : option.value === 'fill' ? 'ws:h-full ws:w-full ws:rounded-none' : 'ws:h-3 ws:w-3',
                ]"
              />
            </span>
          </template>
        </ChoiceTiles>
      </StyleRow>
      <StyleRow label="Picture anchored to" :names="['objectPosition']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('objectPosition')"
          :inherited="inheritedOf('objectPosition')"
          :options="POSITION"
          :columns="5"
          group-label="Picture anchored to"
          :disabled="readOnly"
          @update:model-value="editor.set('objectPosition', $event)"
        />
      </StyleRow>
      <StyleRow label="Content bigger than the element" :names="['overflow']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('overflow')"
          :inherited="inheritedOf('overflow')"
          :options="OVERFLOW"
          :columns="3"
          group-label="Content bigger than the element"
          :disabled="readOnly"
          @update:model-value="editor.set('overflow', $event)"
        />
      </StyleRow>
    </template>
  </div>
</template>
