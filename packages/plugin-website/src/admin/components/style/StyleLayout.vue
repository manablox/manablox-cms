<script setup lang="ts">
import type { StylePropName, ThemeDesign } from '@manablox/site';
import { computed } from 'vue';
import { mainAxis, type StyleEditor } from '../../model/style-visual';
import AlignPad from './AlignPad.vue';
import ChoiceTiles from './ChoiceTiles.vue';
import StyleRow from './StyleRow.vue';

/** How an element arranges what is inside it: stacked, in a row or in a grid, and where. */
const props = defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  advanced: boolean;
  readOnly: boolean;
}>();

const read = (prop: StylePropName) => props.editor.value(prop) as string | undefined;
const inheritedOf = (prop: StylePropName) => props.editor.inherited(prop) as string | undefined;
const effective = (prop: StylePropName) => read(prop) ?? inheritedOf(prop);

type Arrange = 'stack' | 'row' | 'grid' | 'block';
const ARRANGE = [
  { value: 'stack' as const, label: 'Stacked', title: 'Children under each other' },
  { value: 'row' as const, label: 'In a row', title: 'Children side by side' },
  { value: 'grid' as const, label: 'Grid', title: 'Children in columns' },
  { value: 'block' as const, label: 'Normal', title: 'Children flow like text' },
];

function arrangeOf(
  display: string | undefined,
  direction: string | undefined,
): Arrange | undefined {
  if (display === 'grid') return 'grid';
  if (display === 'block') return 'block';
  if (display === 'flex' || display === 'inline-flex')
    return mainAxis(direction) === 'column' ? 'stack' : 'row';
  return undefined;
}
const arrange = computed(() =>
  arrangeOf(read('display'), read('direction') ?? inheritedOf('direction')),
);
const inheritedArrange = computed(() =>
  arrangeOf(inheritedOf('display'), inheritedOf('direction')),
);
const shown = computed(() => arrange.value ?? inheritedArrange.value);

function setArrange(value: Arrange | undefined) {
  const reversed = (read('direction') ?? '').endsWith('-reverse');
  const direction = (base: string) => (reversed ? `${base}-reverse` : base);
  if (value === undefined) props.editor.patch({ display: undefined, direction: undefined });
  else if (value === 'stack')
    props.editor.patch({ display: 'flex', direction: direction('column') });
  else if (value === 'row') props.editor.patch({ display: 'flex', direction: direction('row') });
  else props.editor.patch({ display: value, direction: undefined });
}

const flex = computed(() => shown.value === 'stack' || shown.value === 'row');
const axis = computed(() => mainAxis(effective('direction')));

const SPREAD = [
  {
    value: 'between',
    label: 'Space between',
    title: 'First and last at the edges, equal space between',
  },
  { value: 'around', label: 'Space around', title: 'Equal space around each child' },
  { value: 'evenly', label: 'Space evenly', title: 'Equal space between and at the edges' },
];
const spread = computed(() => {
  const value = read('justify');
  return value === 'between' || value === 'around' || value === 'evenly' ? value : undefined;
});
const inheritedSpread = computed(() => {
  const value = inheritedOf('justify');
  return value === 'between' || value === 'around' || value === 'evenly' ? value : undefined;
});

const COLUMNS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: `${index + 1}`,
  title: `${index + 1} ${index ? 'columns' : 'column'}`,
}));

const reversed = computed(() => (effective('direction') ?? '').endsWith('-reverse'));
function setReversed(value: boolean | undefined) {
  const base = axis.value;
  props.editor.set('direction', value ? `${base}-reverse` : base);
}

const WRAP = [
  { value: false, label: 'One line', title: 'Children squeeze onto one line' },
  { value: true, label: 'Wrap', title: 'Children move to a new line when there is no room' },
];
const YES_NO = [
  { value: false, label: 'No' },
  { value: true, label: 'Yes' },
];
const SELF = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Stretch' },
];
</script>

<template>
  <div class="ws:space-y-4">
    <StyleRow label="Arrange content" :names="['display', 'direction']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="arrange"
        :inherited="inheritedArrange"
        :options="ARRANGE"
        :columns="4"
        labelled
        group-label="Arrange content"
        :disabled="readOnly"
        @update:model-value="setArrange"
      >
        <template #tile="{ option, active }">
          <span class="ws:grid ws:h-6 ws:w-8 ws:gap-0.5 ws:rounded-sm ws:p-0.5" :class="[
            option.value === 'stack' ? 'ws:grid-rows-3' : option.value === 'row' ? 'ws:grid-cols-3' : option.value === 'grid' ? 'ws:grid-cols-2 ws:grid-rows-2' : 'ws:grid-cols-1',
            active ? 'ws:bg-brand-100 ws:dark:bg-brand-900/40' : 'ws:bg-surface-100 ws:dark:bg-surface-800',
          ]">
            <template v-if="option.value === 'block'">
              <span class="ws:h-1 ws:rounded-pill" :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-400'" />
              <span class="ws:h-1 ws:w-4/5 ws:rounded-pill" :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-400'" />
              <span class="ws:h-1 ws:w-3/5 ws:rounded-pill" :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-400'" />
            </template>
            <span v-for="n in option.value === 'grid' ? 4 : 3" v-else :key="n" class="ws:rounded-[2px]" :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-400'" />
          </span>
        </template>
      </ChoiceTiles>
    </StyleRow>

    <StyleRow v-if="shown === 'grid'" label="Columns" :names="['columns']" :editor="editor" :read-only="readOnly">
      <ChoiceTiles
        :model-value="editor.value('columns') as number | undefined"
        :inherited="editor.inherited('columns') as number | undefined"
        :options="COLUMNS"
        :columns="6"
        group-label="Columns"
        :disabled="readOnly"
        @update:model-value="editor.set('columns', $event)"
      >
        <template #tile="{ option, active }">
          <span class="ws:flex ws:h-4 ws:w-full ws:items-stretch ws:gap-px ws:px-0.5" :title="option.title">
            <span v-for="n in option.value" :key="n" class="ws:flex-1 ws:rounded-[1px]" :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-300 ws:dark:bg-surface-600'" />
          </span>
        </template>
      </ChoiceTiles>
    </StyleRow>

    <StyleRow v-if="flex || shown === 'grid'" label="Position" :names="['justify', 'align']" :editor="editor" :read-only="readOnly">
      <div class="ws:flex ws:items-start ws:gap-3">
        <AlignPad
          :justify="read('justify')"
          :align="read('align')"
          :inherited-justify="inheritedOf('justify')"
          :inherited-align="inheritedOf('align')"
          :axis="shown === 'grid' ? 'row' : axis"
          :disabled="readOnly"
          @place="(justify, align) => editor.patch({ justify, align })"
        />
        <div class="ws:min-w-0 ws:flex-1 ws:space-y-1.5">
          <p class="ws:text-2xs ws:text-surface-500">Or share out the free space:</p>
          <ChoiceTiles
            :model-value="spread"
            :inherited="inheritedSpread"
            :options="SPREAD"
            :columns="3"
            group-label="Share out the free space"
            :disabled="readOnly"
            @update:model-value="editor.set('justify', $event)"
          >
            <template #tile="{ option, active }">
              <span class="ws:flex ws:h-3 ws:w-full ws:items-center ws:px-0.5" :class="option.value === 'between' ? 'ws:justify-between' : option.value === 'around' ? 'ws:justify-around' : 'ws:justify-evenly'">
                <span v-for="n in 3" :key="n" class="ws:h-3 ws:w-1 ws:rounded-[1px]" :class="active ? 'ws:bg-brand-500' : 'ws:bg-surface-400'" />
              </span>
            </template>
          </ChoiceTiles>
          <button
            type="button"
            class="ws:flex ws:w-full ws:items-center ws:justify-between ws:rounded-control ws:border ws:px-2 ws:py-1 ws:text-2xs ws:disabled:opacity-50"
            :class="read('align') === 'stretch' ? 'ws:border-brand-500 ws:bg-brand-50 ws:text-brand-700 ws:dark:bg-brand-900/30 ws:dark:text-brand-200' : 'ws:border-surface-200 ws:hover:bg-surface-50 ws:dark:border-surface-700 ws:dark:hover:bg-surface-800'"
            :aria-pressed="read('align') === 'stretch'"
            :disabled="readOnly"
            @click="editor.set('align', read('align') === 'stretch' ? undefined : 'stretch')"
          >
            Stretch children to fill {{ axis === 'row' ? 'the height' : 'the width' }}
          </button>
        </div>
      </div>
    </StyleRow>

    <div v-if="flex" class="ws:grid ws:grid-cols-2 ws:gap-3">
      <StyleRow label="Line breaks" :names="['wrap']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="editor.value('wrap') as boolean | undefined"
          :inherited="editor.inherited('wrap') as boolean | undefined"
          :options="WRAP"
          :columns="2"
          group-label="Line breaks"
          :disabled="readOnly"
          @update:model-value="editor.set('wrap', $event)"
        />
      </StyleRow>
      <StyleRow label="Order" :names="[]" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('direction') === undefined ? undefined : reversed"
          :options="[{ value: false, label: 'Normal' }, { value: true, label: 'Reversed', title: 'Last child first' }]"
          :columns="2"
          group-label="Order"
          :disabled="readOnly"
          @update:model-value="setReversed"
        />
      </StyleRow>
    </div>

    <template v-if="advanced">
      <p class="ws:border-t ws:border-surface-200 ws:pt-3 ws:text-xs ws:font-semibold ws:dark:border-surface-800">Inside its parent</p>
      <StyleRow label="Align itself" :names="['alignSelf']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="read('alignSelf')"
          :inherited="inheritedOf('alignSelf')"
          :options="SELF"
          group-label="Align itself"
          :disabled="readOnly"
          @update:model-value="editor.set('alignSelf', $event)"
        />
      </StyleRow>
      <StyleRow label="Grow to fill the free space" :names="['grow']" :editor="editor" :read-only="readOnly">
        <ChoiceTiles
          :model-value="editor.value('grow') as boolean | undefined"
          :inherited="editor.inherited('grow') as boolean | undefined"
          :options="YES_NO"
          :columns="2"
          group-label="Grow to fill the free space"
          :disabled="readOnly"
          @update:model-value="editor.set('grow', $event)"
        />
      </StyleRow>
    </template>
  </div>
</template>
