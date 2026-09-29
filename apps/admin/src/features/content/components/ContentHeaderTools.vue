<script setup lang="ts">
import type { ContentEditorDraft } from '@manablox/admin-plugin';
import FeatureGate from '@manablox/admin-sdk/components/feature/FeatureGate.vue';
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import type { ContentTypeSummary } from '@manablox/admin-sdk/lib/api-types';
import { shortcutHint } from '@manablox/admin-sdk/lib/shortcuts';
import type { FeatureKey } from '@manablox/core';
import PluginSlot from '~/components/PluginSlot';
import { useDraftStore } from '../useDraftStore';

/** The document editor header's undo and redo, its views (visual, plugins'), plugin actions and the history toggle. */
defineProps<{
  contentType: ContentTypeSummary;
  /** The draft as plugin views see it. */
  editorDraft: ContentEditorDraft;
  /** Offers the visual editor. */
  hasBlockField: boolean;
  closeView: () => void;
}>();

const emit = defineEmits<{
  visual: [];
  /** A plugin view to open, by its slot key. */
  view: [key: string];
}>();

const showHistory = defineModel<boolean>('history', { required: true });

const draft = useDraftStore();
</script>

<template>
  <div class="flex items-center rounded-control bg-surface-100 p-0.5 dark:bg-surface-800">
    <button class="mb-btn-ghost mb-btn-sm" :disabled="!draft.canUndo" :title="shortcutHint('mod+z', 'Undo')" aria-label="Undo" @click="draft.undo()">
      <Icon name="undo" />
    </button>
    <button class="mb-btn-ghost mb-btn-sm" :disabled="!draft.canRedo" :title="shortcutHint('shift+mod+z', 'Redo')" aria-label="Redo" @click="draft.redo()">
      <Icon name="redo" />
    </button>
  </div>
  <FeatureGate v-if="hasBlockField" feature="visualEditor" label="Visual" trigger-class="mb-btn-ghost">
    <button class="mb-btn-ghost" title="Edit against the live site" @click="emit('visual')">
      <Icon name="eye" /> Visual
    </button>
  </FeatureGate>
  <template v-if="draft.doc">
    <PluginSlot id="content.editor.views" :props="{ document: draft.doc, type: contentType, draft: editorDraft, close: closeView }" locked>
      <template #default="{ items }">
        <template v-for="view in items" :key="view.key">
          <FeatureGate v-if="view.feature" :feature="view.feature as FeatureKey" :label="view.label ?? view.key" trigger-class="mb-btn-ghost">
            <button class="mb-btn-ghost" :title="view.entry.hint" @click="emit('view', view.key)">
              <Icon :name="view.icon ?? 'eye'" /> {{ view.label ?? view.key }}
            </button>
          </FeatureGate>
          <button v-else class="mb-btn-ghost" :title="view.entry.hint" @click="emit('view', view.key)">
            <Icon :name="view.icon ?? 'eye'" /> {{ view.label ?? view.key }}
          </button>
        </template>
      </template>
    </PluginSlot>
    <PluginSlot id="content.editor.actions" :props="{ document: draft.doc, type: contentType }" />
    <button
      v-if="draft.doc.id"
      class="mb-btn-ghost"
      :class="showHistory ? 'bg-surface-200/70 dark:bg-surface-800' : ''"
      :aria-pressed="showHistory"
      @click="showHistory = !showHistory"
    >
      <Icon name="clock" /> History
    </button>
  </template>
</template>
