<script setup lang="ts">
import type { StylePropName, ThemeDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import { lengthPx, type StyleEditor } from '../../model/style-visual';
import SizeInput from '../SizeInput.vue';
import ChoiceTiles from './ChoiceTiles.vue';
import StyleRow from './StyleRow.vue';

/** How wide and tall an element gets: the theme's content widths as bars, and shapes. */
const props = defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  advanced: boolean;
  readOnly: boolean;
}>();

const read = (prop: StylePropName) => props.editor.value(prop) as string | undefined;
const inheritedOf = (prop: StylePropName) => props.editor.inherited(prop) as string | undefined;

const widths = computed(() => {
  const entries = Object.entries(props.theme.container.widths)
    .map(([name, value]) => ({ name, value, px: lengthPx(value) ?? 0 }))
    .sort((a, b) => a.px - b.px);
  const max = Math.max(1, ...entries.map((entry) => entry.px));
  return [
    ...entries.map((entry) => ({
      value: `container:${entry.name}`,
      label: entry.name,
      hint: entry.value,
      share: Math.max(12, (entry.px / max) * 100),
    })),
    { value: 'none', label: 'Full', hint: 'none', share: 100 },
  ];
});
const maxWidth = computed(() => read('maxWidth'));
const custom = ref(false);
const isCustom = computed(
  () =>
    custom.value ||
    (maxWidth.value !== undefined && !widths.value.some((entry) => entry.value === maxWidth.value)),
);

function pickWidth(value: string) {
  custom.value = false;
  props.editor.set('maxWidth', maxWidth.value === value ? undefined : value);
}

const RATIOS = ['1/1', '4/3', '3/2', '16/9', '21/9', '3/4', '2/3', '9/16'].map((value) => {
  const [w, h] = value.split('/').map(Number) as [number, number];
  const scale = 22 / Math.max(w, h);
  return { value, label: value.replace('/', ':'), w: w * scale, h: h * scale };
});
const ratioOptions = [...RATIOS, { value: 'auto', label: 'Free', w: 0, h: 0 }];
const ratioOf = (value: string) => ratioOptions.find((entry) => entry.value === value);

const SIZES: ReadonlyArray<{
  prop: StylePropName;
  label: string;
  keywords?: string[];
  container?: boolean;
}> = [
  { prop: 'width', label: 'Width', keywords: ['auto'], container: true },
  { prop: 'minWidth', label: 'Min width' },
  { prop: 'height', label: 'Height', keywords: ['auto'] },
  { prop: 'minHeight', label: 'Min height' },
  { prop: 'maxHeight', label: 'Max height', keywords: ['none'] },
];
</script>

<template>
  <div class="ws:space-y-4">
    <StyleRow label="Maximum width" :names="['maxWidth']" :editor="editor" :read-only="readOnly" hint="The element never grows wider than this, and is centred when it has room.">
      <div class="ws:space-y-0.5" role="group" aria-label="Maximum width">
        <button
          v-for="entry in widths"
          :key="entry.value"
          type="button"
          class="ws:group ws:flex ws:w-full ws:items-center ws:gap-2 ws:rounded-control ws:px-1.5 ws:py-1 ws:text-left ws:disabled:opacity-50"
          :class="maxWidth === entry.value ? 'ws:bg-brand-50 ws:dark:bg-brand-900/30' : 'ws:hover:bg-surface-100 ws:dark:hover:bg-surface-800'"
          :aria-pressed="maxWidth === entry.value"
          :aria-label="`${entry.label}, ${entry.hint}`"
          :disabled="readOnly"
          @click="pickWidth(entry.value)"
        >
          <span class="ws:w-8 ws:shrink-0 ws:text-xs ws:font-medium">{{ entry.label }}</span>
          <span class="ws:flex ws:h-4 ws:min-w-0 ws:flex-1 ws:items-center ws:rounded-sm ws:bg-surface-100 ws:dark:bg-surface-800">
            <span
              class="ws:block ws:h-full ws:rounded-sm"
              :class="maxWidth === entry.value ? 'ws:bg-brand-500' : inheritedOf('maxWidth') === entry.value && maxWidth === undefined ? 'ws:border ws:border-dashed ws:border-surface-500' : 'ws:bg-surface-300 ws:group-hover:bg-surface-400 ws:dark:bg-surface-600'"
              :style="{ width: `${entry.share}%` }"
            />
          </span>
          <span class="ws:w-14 ws:shrink-0 ws:text-right ws:font-mono ws:text-2xs ws:text-surface-500">{{ entry.hint }}</span>
        </button>
        <button
          v-if="!isCustom && !readOnly"
          type="button"
          class="ws:mt-1 ws:text-2xs ws:text-brand-700 ws:hover:underline ws:dark:text-brand-300"
          @click="custom = true"
        >
          Type an exact width
        </button>
        <SizeInput
          v-else-if="isCustom"
          class="ws:mt-1"
          :model-value="maxWidth"
          :keywords="['none']"
          :placeholder="inheritedOf('maxWidth') ?? 'e.g. 40rem or 80%'"
          :disabled="readOnly"
          @update:model-value="editor.set('maxWidth', $event)"
        />
      </div>
    </StyleRow>

    <StyleRow label="Shape" :names="['aspectRatio']" :editor="editor" :read-only="readOnly" hint="Width to height; mostly for images and videos.">
      <ChoiceTiles
        :model-value="read('aspectRatio')"
        :inherited="inheritedOf('aspectRatio')"
        :options="ratioOptions"
        :columns="5"
        labelled
        group-label="Shape"
        :disabled="readOnly"
        @update:model-value="editor.set('aspectRatio', $event)"
      >
        <template #tile="{ option, active }">
          <span class="ws:flex ws:h-6 ws:items-center ws:justify-center">
            <span
              v-if="ratioOf(option.value)?.w"
              class="ws:block ws:rounded-[2px] ws:border-2"
              :class="active ? 'ws:border-brand-500 ws:bg-brand-100 ws:dark:bg-brand-900/40' : 'ws:border-surface-400'"
              :style="{ width: `${ratioOf(option.value)?.w}px`, height: `${ratioOf(option.value)?.h}px` }"
            />
            <span v-else class="ws:text-xs">auto</span>
          </span>
        </template>
      </ChoiceTiles>
    </StyleRow>

    <div v-if="advanced" class="ws:grid ws:grid-cols-2 ws:gap-3 ws:border-t ws:border-surface-200 ws:pt-3 ws:dark:border-surface-800">
      <StyleRow v-for="size in SIZES" :key="size.prop" :label="size.label" :names="[size.prop]" :editor="editor" :read-only="readOnly">
        <SizeInput
          :id="`style-${size.prop}`"
          :model-value="read(size.prop)"
          :keywords="size.keywords"
          :containers="size.container ? theme.container.widths : undefined"
          :placeholder="inheritedOf(size.prop) ?? 'auto'"
          :disabled="readOnly"
          @update:model-value="editor.set(size.prop, $event)"
        />
      </StyleRow>
    </div>
  </div>
</template>
