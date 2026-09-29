<script setup lang="ts">
import type { AdminSlotProps, ContentEditorDraft } from '@manablox/admin-plugin';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import IconButton from '@manablox/admin-sdk/components/ui/IconButton.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import SegmentedControl from '@manablox/admin-sdk/components/ui/SegmentedControl.vue';
import Select from '@manablox/admin-sdk/components/ui/Select.vue';
import type { FieldDefinition } from '@manablox/admin-sdk/lib/api-types';
import { shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import type { BlockBreakpoint } from '@manablox/core';
import PluginSlot from '~/components/PluginSlot';
import type { SlotItem } from '~/lib/plugins/registry';

type TargetProps = AdminSlotProps['content.preview.target'];

/**
 * The visual editor's top bar: back and the connection state, the preview width, the plugins'
 * frame controls, the block field picker, undo, redo, save and close.
 */
defineProps<{
  title: string;
  connected: boolean;
  /** The plugin frame's status line. */
  status: string | undefined;
  deviceOptions: { value: BlockBreakpoint; label: string; icon?: string }[];
  frameWidth: number;
  scale: number;
  blockFields: FieldDefinition[];
  draft: ContentEditorDraft;
  close: () => void;
  targetProps: () => TargetProps;
  targetPropsOf: (item: SlotItem<'content.preview.target'>) => TargetProps;
}>();

const device = defineModel<BlockBreakpoint>('device', { required: true });
const activeField = defineModel<string | null>('activeField', { required: true });
</script>

<template>
  <header class="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-surface-200 bg-surface-0 px-3 dark:border-surface-800 dark:bg-surface-900">
    <div class="flex min-w-0 items-center gap-2">
      <IconButton icon="chevron" icon-class="mb-icon rotate-180" label="Back to the document editor" size="md" @click="close()" />
      <div class="min-w-0">
        <div class="truncate font-display text-sm font-bold">{{ title || 'Untitled' }}</div>
        <div class="flex items-center gap-1.5 text-2xs text-surface-500">
          <span class="inline-block h-1.5 w-1.5 rounded-pill" :class="connected ? 'bg-ok-500' : 'bg-warn-500'" />
          {{ connected ? 'Live preview connected' : 'Waiting for the site...' }}
          <template v-if="status"> - {{ status }}</template>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <SegmentedControl v-model="device" :options="deviceOptions" aria-label="Preview width" icon-only />
      <span class="hidden w-24 mb-meta tabular-nums sm:inline">
        {{ frameWidth }}px{{ scale < 1 ? ` - ${Math.round(scale * 100)}%` : '' }}
      </span>
    </div>

    <div class="flex items-center justify-end gap-1">
      <PluginSlot id="content.preview.target" :props="targetProps()">
        <template #default="{ items }">
          <component :is="item.component" v-for="item in items" :key="item.key" v-bind="targetPropsOf(item)" />
        </template>
      </PluginSlot>
      <Select
        v-if="blockFields.length > 1"
        v-model="activeField"
        variant="sm"
        class="!w-auto"
        aria-label="Block field"
        :options="blockFields.map((field) => ({ value: field.name, label: field.label }))"
      />
      <IconButton icon="undo" label="Undo" :title="shortcutHint('mod+z', 'Undo')" size="md" :disabled="!draft.canUndo" @click="draft.undo()" />
      <IconButton icon="redo" label="Redo" :title="shortcutHint('shift+mod+z', 'Redo')" size="md" :disabled="!draft.canRedo" @click="draft.redo()" />
      <span class="mx-1 h-5 w-px bg-surface-200 dark:bg-surface-700" />
      <SaveButton v-if="!draft.readOnly" :saving="draft.saving" :disabled="!draft.isDirty" @click="draft.save()" />
      <button type="button" class="mb-btn-ghost" @click="close()"><Icon name="x" class="mb-icon" /> Close</button>
    </div>
  </header>
</template>
