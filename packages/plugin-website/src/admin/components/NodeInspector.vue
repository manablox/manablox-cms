<script setup lang="ts">
import { Icon, Tabs } from '@manablox/admin-sdk';
import type { DesignNode, StyleRules } from '@manablox/site';
import { computed, ref } from 'vue';
import { ELEMENT_HINTS, ELEMENT_ICONS, ELEMENT_LABELS } from '../model/elements';
import { useDesignerContext } from '../useDesignerContext';
import NodeContentSection from './NodeContentSection.vue';
import NodeVisibilitySection from './NodeVisibilitySection.vue';
import StyleInspector from './StyleInspector.vue';

/** The inspector of the selected node: Content, Style (per breakpoint and state), Visibility. */
const props = defineProps<{ node: DesignNode }>();
const emit = defineEmits<{ update: [node: DesignNode, group?: string] }>();

const { theme, breakpoint, readOnly, labelFor } = useDesignerContext();
const label = computed(() => labelFor(props.node));

type Tab = 'content' | 'style' | 'visibility';
const TABS = [
  { id: 'content', label: 'Content', icon: 'file-pen' },
  { id: 'style', label: 'Style', icon: 'palette' },
  { id: 'visibility', label: 'Visibility', icon: 'eye' },
] as const;
const tab = ref<Tab>('content');

function setStyle(style: StyleRules | undefined) {
  const next: DesignNode = { ...props.node };
  if (style) next.style = style;
  else delete next.style;
  emit('update', next, `style:${props.node.id}`);
}
</script>

<template>
  <div class="ws:space-y-3">
    <div class="ws:flex ws:items-center ws:gap-2.5">
      <span class="ws:flex ws:h-8 ws:w-8 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-control ws:bg-brand-50 ws:text-brand-700 ws:dark:bg-brand-900/30 ws:dark:text-brand-300">
        <Icon :name="ELEMENT_ICONS[node.el]" class="mb-icon" />
      </span>
      <div class="ws:min-w-0 ws:flex-1">
        <h2 class="ws:flex ws:items-center ws:gap-2 ws:text-sm ws:font-bold">
          <span class="ws:truncate" :title="label">{{ label }}</span>
          <span class="mb-badge ws:shrink-0">{{ ELEMENT_LABELS[node.el] }}</span>
        </h2>
        <p v-if="ELEMENT_HINTS[node.el]" class="ws:truncate ws:text-2xs ws:text-surface-500" :title="ELEMENT_HINTS[node.el]">{{ ELEMENT_HINTS[node.el] }}</p>
      </div>
    </div>
    <Tabs v-model="tab" :tabs="TABS" aria-label="Inspector" />
    <NodeContentSection v-if="tab === 'content'" :node="node" @update="(next, group) => emit('update', next, group)" />
    <template v-else-if="tab === 'style'">
      <StyleInspector
        v-if="theme"
        :model-value="node.style"
        :element="node.el"
        :theme="theme"
        :breakpoint="breakpoint"
        :read-only="readOnly"
        @update:model-value="setStyle"
      />
    </template>
    <NodeVisibilitySection v-else :node="node" @update="(next) => emit('update', next)" />
  </div>
</template>
