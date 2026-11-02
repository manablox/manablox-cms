<script lang="ts">
/** What the sample sits on; shared, so it stays while the selection changes. */
const backdrop = ref<'none' | 'light' | 'dark'>('none');
</script>

<script setup lang="ts">
import { SegmentedControl } from '@manablox/admin-sdk';
import type { StylePropName, ThemeDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import { resolveColor } from '../../model/color';
import type { StyleEditor } from '../../model/style-visual';
import { colorRefCss } from '../../model/tokens';
import TokenPicker from '../TokenPicker.vue';
import StyleRow from './StyleRow.vue';

/**
 * Text and background color, with a sample of the two together on a transparent, or the
 * theme's light or dark page, where theme colors take that scheme's values.
 */
const props = defineProps<{
  editor: StyleEditor;
  theme: ThemeDesign;
  readOnly: boolean;
}>();

const BACKDROPS = [
  { value: 'none' as const, label: 'Transparent', icon: 'grid' },
  { value: 'light' as const, label: 'On the light page', icon: 'sun' },
  { value: 'dark' as const, label: 'On the dark page', icon: 'moon' },
];

const read = (prop: StylePropName) => props.editor.value(prop) as string | undefined;
const inheritedOf = (prop: StylePropName) => props.editor.inherited(prop) as string | undefined;

const scheme = computed(() => (backdrop.value === 'dark' ? 'dark' : 'light'));
const css = (prop: StylePropName) =>
  colorRefCss(props.theme, read(prop) ?? inheritedOf(prop), scheme.value);
const page = (role: 'bg' | 'text') => resolveColor(props.theme.colors, role, scheme.value);

const surface = computed(() =>
  backdrop.value === 'none' ? undefined : { background: page('bg') ?? undefined },
);
// On a page, unset text shows the page's text color, as on the site.
const sample = computed(() => ({
  color: css('color') ?? (backdrop.value === 'none' ? undefined : (page('text') ?? undefined)),
  background: css('background') ?? undefined,
}));
</script>

<template>
  <div class="ws:space-y-3">
    <div class="ws:relative">
      <div
        class="ws:flex ws:h-14 ws:items-center ws:justify-center ws:rounded-control ws:border ws:border-surface-200 ws:dark:border-surface-700"
        :class="surface ? '' : 'ws:bg-[repeating-conic-gradient(var(--ws-color-surface-200)_0_25%,transparent_0_50%)] ws:bg-[length:12px_12px] ws:dark:bg-[repeating-conic-gradient(var(--ws-color-surface-700)_0_25%,transparent_0_50%)]'"
        :style="surface"
        aria-hidden="true"
      >
        <span class="ws:rounded-control ws:px-4 ws:py-1.5 ws:text-lg ws:font-semibold" :style="sample">Aa Bb Cc</span>
      </div>
      <SegmentedControl v-model="backdrop" :options="BACKDROPS" icon-only aria-label="Preview background" class="ws:absolute ws:top-1 ws:right-1" />
    </div>
    <div class="ws:grid ws:grid-cols-2 ws:gap-3">
      <StyleRow label="Text" :names="['color']" :editor="editor" :read-only="readOnly">
        <TokenPicker
          :model-value="read('color')"
          group="color"
          :theme="theme"
          :inherited="inheritedOf('color')"
          aria-label="Text color"
          :disabled="readOnly"
          @update:model-value="editor.set('color', $event)"
        />
      </StyleRow>
      <StyleRow label="Background" :names="['background']" :editor="editor" :read-only="readOnly">
        <TokenPicker
          :model-value="read('background')"
          group="color"
          :theme="theme"
          :inherited="inheritedOf('background')"
          aria-label="Background"
          :disabled="readOnly"
          @update:model-value="editor.set('background', $event)"
        />
      </StyleRow>
    </div>
  </div>
</template>
