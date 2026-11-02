<script setup lang="ts">
import type { StylePropName, ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import type { StyleEditor } from '../../model/style-visual';
import { colorRefCss, tokenOptions } from '../../model/tokens';
import TokenPicker from '../TokenPicker.vue';
import ChoiceTiles from './ChoiceTiles.vue';
import StyleRow from './StyleRow.vue';

/** Border, corners and shadow, every choice drawn as it looks. */
const props = defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  readOnly: boolean;
}>();

const read = (prop: StylePropName) => props.editor.value(prop) as string | undefined;
const inheritedOf = (prop: StylePropName) => props.editor.inherited(prop) as string | undefined;

const WIDTHS = ['0', '1px', '2px', '3px', '4px'].map((value) => ({
  value,
  label: value === '0' ? 'None' : value,
}));
const STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'none', label: 'None' },
];
const borderColor = computed(
  () =>
    colorRefCss(props.theme, read('borderColor') ?? inheritedOf('borderColor')) ?? 'currentColor',
);

const radii = computed(() => [
  { value: '0', label: 'Square', css: '0' },
  ...tokenOptions(props.theme, 'radius')
    .filter((option) => option.label !== 'none')
    .map((option) => ({
      value: option.value,
      label: option.label,
      title: `${option.label} (${option.hint})`,
      css: option.hint ?? '0',
    })),
]);
const shadows = computed(() => [
  { value: 'none', label: 'None', css: 'none' },
  ...tokenOptions(props.theme, 'shadow').map((option) => ({
    value: option.value,
    label: option.label,
    css: option.hint ?? 'none',
  })),
]);
</script>

<template>
  <div class="ws:space-y-4">
    <StyleRow label="Border" :names="['borderWidth', 'borderStyle']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="read('borderWidth')"
        :inherited="inheritedOf('borderWidth')"
        :options="WIDTHS"
        :columns="5"
        labelled
        group-label="Border width"
        :disabled="readOnly"
        @update:model-value="editor.set('borderWidth', $event)"
      >
        <template #tile="{ option, active }">
          <span class="ws:flex ws:h-4 ws:w-8 ws:items-center">
            <span
              v-if="option.value !== '0'"
              class="ws:block ws:w-full"
              :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-500'"
              :style="{ height: option.value }"
            />
            <span v-else class="ws:block ws:w-full ws:border-t ws:border-dashed ws:border-surface-300" />
          </span>
        </template>
      </ChoiceTiles>
      <ChoiceTiles
        :model-value="read('borderStyle')"
        :inherited="inheritedOf('borderStyle')"
        :options="STYLES"
        :columns="4"
        labelled
        group-label="Border style"
        :disabled="readOnly"
        @update:model-value="editor.set('borderStyle', $event)"
      >
        <template #tile="{ option, active }">
          <span
            class="ws:block ws:h-0 ws:w-8 ws:border-t-2"
            :class="[active ? 'ws:border-brand-500' : 'ws:border-surface-500', option.value === 'none' ? 'ws:border-transparent' : '']"
            :style="{ borderTopStyle: option.value === 'none' ? 'solid' : (option.value as 'solid') }"
          />
        </template>
      </ChoiceTiles>
    </StyleRow>

    <StyleRow label="Border color" :names="['borderColor']" :editor="editor" :read-only="readOnly">
      <TokenPicker
        :model-value="read('borderColor')"
        group="color"
        :theme="theme"
        :inherited="inheritedOf('borderColor')"
        aria-label="Border color"
        :disabled="readOnly"
        @update:model-value="editor.set('borderColor', $event)"
      />
    </StyleRow>

    <StyleRow label="Corners" :names="['radius']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="read('radius')"
        :inherited="inheritedOf('radius')"
        :options="radii"
        :columns="Math.min(5, radii.length)"
        labelled
        group-label="Corners"
        :disabled="readOnly"
        @update:model-value="editor.set('radius', $event)"
      >
        <template #tile="{ option, active }">
          <span
            class="ws:block ws:h-5 ws:w-5 ws:border-t-2 ws:border-l-2"
            :class="active ? 'ws:border-brand-500' : 'ws:border-surface-500'"
            :style="{ borderTopLeftRadius: `min(${radii.find((entry) => entry.value === option.value)?.css ?? '0'}, 20px)`, borderColor }"
          />
        </template>
      </ChoiceTiles>
    </StyleRow>

    <StyleRow label="Shadow" :names="['shadow']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="read('shadow')"
        :inherited="inheritedOf('shadow')"
        :options="shadows"
        :columns="Math.min(4, shadows.length)"
        labelled
        group-label="Shadow"
        :disabled="readOnly"
        @update:model-value="editor.set('shadow', $event)"
      >
        <template #tile="{ option }">
          <span class="ws:flex ws:h-8 ws:w-full ws:items-center ws:justify-center ws:rounded-sm ws:bg-surface-100 ws:dark:bg-surface-700">
            <span class="ws:block ws:h-4 ws:w-7 ws:rounded-sm ws:bg-white" :style="{ boxShadow: shadows.find((entry) => entry.value === option.value)?.css }" />
          </span>
        </template>
      </ChoiceTiles>
    </StyleRow>
  </div>
</template>
