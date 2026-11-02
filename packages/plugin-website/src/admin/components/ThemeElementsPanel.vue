<script setup lang="ts">
import { FormField, Select } from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import type { StyleRules, ThemeDesign, ThemeElements } from '@manablox/site';
import { computed, ref } from 'vue';
import StyleInspector from './StyleInspector.vue';

/** Base styles of plain elements: body, links, buttons, inputs and rich text. */
const props = defineProps<{
  theme: ThemeDesign;
  breakpoint: BlockBreakpoint;
  readOnly?: boolean;
}>();
const emit = defineEmits<{ update: [theme: ThemeDesign, group?: string] }>();

type Target =
  | 'body'
  | 'link'
  | 'button'
  | 'buttons.primary'
  | 'buttons.secondary'
  | 'buttons.ghost'
  | 'input'
  | 'label'
  | 'prose';

const TARGETS: ReadonlyArray<{ value: Target; label: string; hint: string; groups?: string[] }> = [
  {
    value: 'body',
    label: 'Page body',
    hint: 'Background and text of every page',
    groups: ['type', 'color'],
  },
  {
    value: 'link',
    label: 'Links',
    hint: 'Text links, with hover and focus',
    groups: ['type', 'color', 'border'],
  },
  { value: 'button', label: 'All buttons', hint: 'Shared by every button variant' },
  { value: 'buttons.primary', label: 'Primary button', hint: 'The main call to action' },
  { value: 'buttons.secondary', label: 'Secondary button', hint: 'Next to a primary one' },
  { value: 'buttons.ghost', label: 'Ghost button', hint: 'Quiet, text-like' },
  { value: 'input', label: 'Form inputs', hint: 'Text boxes and selects in forms' },
  {
    value: 'label',
    label: 'Form labels',
    hint: 'Above each input',
    groups: ['spacing', 'type', 'color'],
  },
  {
    value: 'prose',
    label: 'Rich text',
    hint: 'Spacing and text of formatted content',
    groups: ['spacing', 'type', 'color', 'size'],
  },
];

const target = ref<Target>('button');
const info = computed(() => TARGETS.find((entry) => entry.value === target.value) ?? TARGETS[0]);

const rules = computed<StyleRules | undefined>(() => {
  const elements = props.theme.elements;
  if (target.value.startsWith('buttons.')) {
    const variant = target.value.slice(8) as 'primary' | 'secondary' | 'ghost';
    return elements.buttons?.[variant];
  }
  return elements[target.value as Exclude<Target, `buttons.${string}`>] as StyleRules | undefined;
});

function update(next: StyleRules | undefined) {
  const elements: ThemeElements = { ...props.theme.elements };
  if (target.value.startsWith('buttons.')) {
    const variant = target.value.slice(8) as 'primary' | 'secondary' | 'ghost';
    const buttons = { ...(elements.buttons ?? {}) };
    if (next) buttons[variant] = next;
    else delete buttons[variant];
    elements.buttons = buttons;
  } else {
    const key = target.value as Exclude<Target, `buttons.${string}`>;
    if (next) elements[key] = next;
    else delete elements[key];
  }
  emit('update', { ...props.theme, elements }, `elements:${target.value}`);
}
</script>

<template>
  <div class="ws:space-y-4">
    <FormField label="Element" :hint="info?.hint">
      <template #default="{ id }">
        <Select :id="id" v-model="target" :options="TARGETS" />
      </template>
    </FormField>
    <StyleInspector
      :key="target"
      :model-value="rules"
      :theme="theme"
      :breakpoint="breakpoint"
      :groups="info?.groups"
      :read-only="readOnly"
      @update:model-value="update"
    />
  </div>
</template>
