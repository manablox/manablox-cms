<script setup lang="ts">
import { Accordion, Icon, SegmentedControl, Switch } from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import type {
  ElementKind,
  StylePropName,
  StyleRuleKey,
  StyleRules,
  ThemeDesign,
} from '@manablox/site';
import { type Component, computed, ref } from 'vue';
import {
  clearStyleTarget,
  countByTarget,
  inheritedValue,
  STYLE_GROUPS,
  STYLE_TARGETS,
  setStyleProps,
} from '../model/style';
import type { StyleEditor } from '../model/style-visual';
import StyleBorder from './style/StyleBorder.vue';
import StyleColors from './style/StyleColors.vue';
import StyleEffects from './style/StyleEffects.vue';
import StyleLayout from './style/StyleLayout.vue';
import StyleSize from './style/StyleSize.vue';
import StyleSpacing from './style/StyleSpacing.vue';
import StyleText from './style/StyleText.vue';

/**
 * Edits `StyleRules`: one breakpoint (from the canvas) and, on desktop, one state at a time.
 * Each group draws its choices: a box model for spacing, bars for widths, tiles for the
 * rest. "Advanced" adds exact sizes and rarer settings.
 */
const props = withDefaults(
  defineProps<{
    modelValue: StyleRules | undefined;
    theme: ThemeDesign;
    /** The canvas breakpoint; tablet and mobile edit their own rules. */
    breakpoint?: BlockBreakpoint;
    /** Section ids of `STYLE_GROUPS` to show; all when absent. */
    groups?: readonly string[] | undefined;
    /** Offer hover, focus and pressed states. */
    states?: boolean;
    /** The element styled, to open the sections that matter for it first. */
    element?: ElementKind | undefined;
    readOnly?: boolean;
  }>(),
  { breakpoint: 'desktop', states: true, readOnly: false },
);
const emit = defineEmits<{ 'update:modelValue': [value: StyleRules | undefined] }>();

const state = ref<StyleRuleKey>('base');
const advanced = ref(false);

const target = computed<StyleRuleKey>(() =>
  props.breakpoint === 'tablet' ? 'tablet' : props.breakpoint === 'mobile' ? 'mobile' : state.value,
);
const counts = computed(() => countByTarget(props.modelValue));
const targetOptions = computed(() =>
  STYLE_TARGETS.map((entry) => ({
    value: entry.value,
    label: counts.value[entry.value]
      ? `${entry.label} (${counts.value[entry.value]})`
      : entry.label,
  })),
);

const SECTIONS: Record<string, { icon: string; component: Component }> = {
  spacing: { icon: 'expand', component: StyleSpacing },
  size: { icon: 'rectangle-horizontal', component: StyleSize },
  layout: { icon: 'layout-grid', component: StyleLayout },
  type: { icon: 'type', component: StyleText },
  color: { icon: 'palette', component: StyleColors },
  border: { icon: 'square', component: StyleBorder },
  effects: { icon: 'sparkles', component: StyleEffects },
};

const shownGroups = computed(() =>
  STYLE_GROUPS.filter(
    (group) => SECTIONS[group.id] && (!props.groups || props.groups.includes(group.id)),
  ).map((group) => ({
    value: group.id,
    label: group.label,
    icon: SECTIONS[group.id]?.icon,
    hint: setCount(group.props),
  })),
);

function setCount(names: readonly StylePropName[]): string | undefined {
  const rule = props.modelValue?.[target.value];
  const count = names.filter((name) => rule?.[name] !== undefined).length;
  return count ? `${count} set` : undefined;
}

const editor: StyleEditor = {
  value: (prop) => props.modelValue?.[target.value]?.[prop],
  inherited: (prop) => inheritedValue(props.modelValue, target.value, prop),
  set: (prop, value) => editor.patch({ [prop]: value }),
  patch: (values) => {
    if (props.readOnly) return;
    emit('update:modelValue', setStyleProps(props.modelValue, target.value, values));
  },
};

const TEXT_ELEMENTS: readonly string[] = [
  'heading',
  'text',
  'richtext',
  'link',
  'button',
  'formSubmit',
  'formMessage',
  'breadcrumbs',
  'localeSwitch',
  'searchLink',
];
const MEDIA_ELEMENTS: readonly string[] = ['image', 'video', 'embed', 'icon', 'logo'];
/** Sections open at first, by what the element is. */
function firstOpen(element: ElementKind | undefined): string[] {
  if (element && TEXT_ELEMENTS.includes(element)) return ['type', 'color', 'spacing'];
  if (element && MEDIA_ELEMENTS.includes(element)) return ['size', 'border', 'spacing'];
  return ['layout', 'spacing', 'color'];
}
const open = ref<string[]>(firstOpen(props.element));
</script>

<template>
  <div class="ws:space-y-3">
    <div class="ws:space-y-2">
      <!-- A row of its own, so the state labels never wrap. -->
      <SegmentedControl
        v-if="states && breakpoint === 'desktop'"
        v-model="state"
        :options="targetOptions"
        :columns="targetOptions.length"
        aria-label="State"
      />
      <p v-else-if="breakpoint !== 'desktop'" class="ws:rounded-control ws:bg-surface-100 ws:px-2 ws:py-1.5 ws:text-xs ws:text-surface-600 ws:dark:bg-surface-800 ws:dark:text-surface-400">
        Styling for {{ breakpoint === 'mobile' ? 'phones' : 'tablets' }} only. Empty values follow
        {{ breakpoint === 'mobile' ? 'tablet and desktop' : 'desktop' }}; dashed frames show them.
      </p>
      <div class="ws:flex ws:justify-end">
        <Switch v-model="advanced" compact>
          <span class="ws:text-xs" title="Exact sizes, single sides and rarer settings">More settings</span>
        </Switch>
      </div>
    </div>

    <Accordion v-model="open" :items="shownGroups" multiple>
      <template #default="{ item }">
        <div class="ws:pb-3">
          <component
            :is="SECTIONS[item.value]?.component"
            :editor="editor"
            :theme="theme"
            :advanced="advanced"
            :read-only="readOnly"
          />
        </div>
      </template>
    </Accordion>

    <button
      v-if="!readOnly"
      type="button"
      class="mb-btn-ghost mb-btn-sm"
      :disabled="!modelValue?.[target]"
      @click="emit('update:modelValue', clearStyleTarget(modelValue, target))"
    >
      <Icon name="reset" class="mb-icon-sm" /> Reset every style to the theme
    </button>
  </div>
</template>
