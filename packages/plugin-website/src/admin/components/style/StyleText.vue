<script setup lang="ts">
import { type StylePropName, type ThemeDesign, TYPE_STEPS } from '@manablox/site';
import { computed } from 'vue';
import { lengthPx, type StyleEditor } from '../../model/style-visual';
import TokenPicker from '../TokenPicker.vue';
import ChoiceTiles from './ChoiceTiles.vue';
import StyleRow from './StyleRow.vue';

/** Text size, font, weight, alignment and case, each shown the way it looks. */
const props = defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  advanced: boolean;
  readOnly: boolean;
}>();

const read = (prop: StylePropName) => props.editor.value(prop) as string | undefined;
const inheritedOf = (prop: StylePropName) => props.editor.inherited(prop) as string | undefined;

const sizes = computed(() =>
  TYPE_STEPS.map((step) => {
    const size = props.theme.type[step]?.size;
    const px = lengthPx(size) ?? 16;
    return {
      value: `type:${step}`,
      label: step,
      title: `${step} (${size ?? 'theme'})`,
      px: Math.min(26, Math.max(10, px * 0.75)),
    };
  }),
);

const weight = computed(() => props.editor.value('fontWeight') as number | undefined);
const inheritedWeight = computed(() => props.editor.inherited('fontWeight') as number | undefined);
/** The weight slider: shows the set or inherited weight, sets the weight when moved. */
const weightValue = computed({
  get: () => weight.value ?? inheritedWeight.value ?? 400,
  set: (value: number) => props.editor.set('fontWeight', value),
});
const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

const ALIGN = [
  { value: 'left', label: 'Left', icon: 'align-left' },
  { value: 'center', label: 'Center', icon: 'align-center' },
  { value: 'right', label: 'Right', icon: 'align-right' },
  { value: 'justify', label: 'Justify', icon: 'align-justify' },
];
const CASE = [
  { value: 'none', label: 'As typed', sample: 'Ab' },
  { value: 'uppercase', label: 'Uppercase', sample: 'AB' },
  { value: 'lowercase', label: 'Lowercase', sample: 'ab' },
  { value: 'capitalize', label: 'Capitalize', sample: 'Ab Cd' },
];
const DECORATION = [
  { value: 'none', label: 'Plain', title: 'No line' },
  { value: 'underline', label: 'Underline', icon: 'underline' },
  { value: 'line-through', label: 'Strike through', icon: 'strikethrough' },
];
const STYLE = [
  { value: 'normal', label: 'Upright' },
  { value: 'italic', label: 'Italic', icon: 'italic' },
];
</script>

<template>
  <div class="ws:space-y-4">
    <StyleRow label="Size" :names="['type']" :editor="editor" :read-only="readOnly" hint="Each size brings its own line height and weight from the theme.">
      <ChoiceTiles
        :model-value="read('type')"
        :inherited="inheritedOf('type')"
        :options="sizes"
        :columns="4"
        labelled
        group-label="Text size"
        :disabled="readOnly"
        @update:model-value="editor.set('type', $event)"
      >
        <template #tile="{ option }">
          <span class="ws:flex ws:h-7 ws:items-end ws:font-semibold ws:leading-none" :style="{ fontSize: `${sizes.find((entry) => entry.value === option.value)?.px ?? 14}px` }">Ag</span>
        </template>
      </ChoiceTiles>
    </StyleRow>

    <StyleRow label="Font" :names="['font']" :editor="editor" :read-only="readOnly">
      <TokenPicker
        id="style-font"
        :model-value="read('font')"
        group="font"
        :theme="theme"
        :inherited="inheritedOf('font')"
        aria-label="Font"
        :disabled="readOnly"
        @update:model-value="editor.set('font', $event)"
      />
    </StyleRow>

    <StyleRow label="Weight" :names="['fontWeight']" :editor="editor" :read-only="readOnly">
      <div class="ws:flex ws:items-center ws:gap-3">
        <span class="ws:w-10 ws:shrink-0 ws:text-center ws:text-xl ws:leading-none" :style="{ fontWeight: weight ?? inheritedWeight ?? 400 }" aria-hidden="true">Aa</span>
        <div class="ws:min-w-0 ws:flex-1">
          <input
            type="range"
            class="mb-range"
            min="100"
            max="900"
            step="100"
            v-model.number="weightValue"
            :class="weight === undefined ? 'ws:opacity-60' : ''"
            aria-label="Font weight"
            :aria-valuetext="WEIGHT_NAMES[weight ?? inheritedWeight ?? 400]"
            :disabled="readOnly"
          />
          <p class="ws:flex ws:justify-between ws:text-2xs ws:text-surface-500">
            <span>{{ weight ? WEIGHT_NAMES[weight] : inheritedWeight ? `${WEIGHT_NAMES[inheritedWeight]} (inherited)` : 'Theme default' }}</span>
            <span class="ws:font-mono">{{ weight ?? inheritedWeight ?? '' }}</span>
          </p>
        </div>
      </div>
    </StyleRow>

    <div class="ws:grid ws:grid-cols-2 ws:gap-3">
      <StyleRow label="Alignment" :names="['textAlign']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('textAlign')"
          :inherited="inheritedOf('textAlign')"
          :options="ALIGN"
          :columns="4"
          group-label="Text alignment"
          :disabled="readOnly"
          @update:model-value="editor.set('textAlign', $event)"
        />
      </StyleRow>
      <StyleRow label="Line" :names="['textDecoration']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('textDecoration')"
          :inherited="inheritedOf('textDecoration')"
          :options="DECORATION"
          :columns="3"
          group-label="Text line"
          :disabled="readOnly"
          @update:model-value="editor.set('textDecoration', $event)"
        >
          <template #tile="{ option }">
            <span v-if="option.value === 'none'" class="ws:text-xs">Ab</span>
            <span v-else class="ws:text-xs" :class="option.value === 'underline' ? 'ws:underline' : 'ws:line-through'">Ab</span>
          </template>
        </ChoiceTiles>
      </StyleRow>
    </div>

    <StyleRow label="Letter case" :names="['textTransform']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="read('textTransform')"
        :inherited="inheritedOf('textTransform')"
        :options="CASE"
        :columns="4"
        labelled
        group-label="Letter case"
        :disabled="readOnly"
        @update:model-value="editor.set('textTransform', $event)"
      >
        <template #tile="{ option }">
          <span class="ws:text-sm ws:font-semibold">{{ CASE.find((entry) => entry.value === option.value)?.sample }}</span>
        </template>
      </ChoiceTiles>
    </StyleRow>

    <StyleRow v-if="advanced" label="Style" :names="['fontStyle']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="read('fontStyle')"
        :inherited="inheritedOf('fontStyle')"
        :options="STYLE"
        :columns="2"
        group-label="Font style"
        :disabled="readOnly"
        @update:model-value="editor.set('fontStyle', $event)"
      >
        <template #tile="{ option }">
          <span class="ws:text-xs" :class="option.value === 'italic' ? 'ws:italic' : ''">{{ option.label }}</span>
        </template>
      </ChoiceTiles>
    </StyleRow>
  </div>
</template>
