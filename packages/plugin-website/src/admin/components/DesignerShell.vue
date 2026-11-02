<script setup lang="ts">
import {
  EditorHeader,
  EmptyState,
  Icon,
  PageState,
  useEditorShortcuts,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import type { ElementKind, SiteDesignKind } from '@manablox/site';
import { computed } from 'vue';
import type { useSiteDesign } from '../queries';
import type { CanvasPayload } from '../useDesignCanvas';
import type { DesignDraft } from '../useDesignDraft';
import type { Designer } from '../useDesigner';
import { useDesignerContext } from '../useDesignerContext';
import { useSiteContext } from '../useSiteContext';
import DesignCanvas from './DesignCanvas.vue';
import DesignDraftNotices from './DesignDraftNotices.vue';
import DesignerActions from './DesignerActions.vue';
import DesignerCanvasTools from './DesignerCanvasTools.vue';
import DesignerElementsPane from './DesignerElementsPane.vue';
import DesignerLayout from './DesignerLayout.vue';
import DesignerTips from './DesignerTips.vue';
import DesignerToolbar from './DesignerToolbar.vue';
import InspectorEmpty from './InspectorEmpty.vue';
import NodeInspector from './NodeInspector.vue';
import SiteModePanel from './SiteModePanel.vue';

/**
 * The frame of the element designers: loading and access states, then the toolbar, the
 * Layers pane, the canvas and the inspector of the selection. Slots: `missing` (the design
 * is gone), `actions` (toolbar buttons), `elements-top`, `canvas-note` and `panes` (below
 * the inspector).
 */
const props = defineProps<{
  designer: Designer;
  draft: Omit<DesignDraft<SiteDesignKind>, 'draft' | 'update'>;
  themeQuery: ReturnType<typeof useSiteDesign>;
  loadingLabel: string;
  /** The design is gone; the `missing` slot shows. */
  missing: boolean;
  title: string;
  /** What kind of design, e.g. "Page design". */
  kind: string;
  icon: string;
  back: { to: string; label: string };
  /** What the actions name, e.g. `the design of "Article"`. */
  what: string;
  /** The label of the overflow menu's start over entry. */
  resetLabel: string;
  unavailable: Partial<Record<ElementKind, string>>;
  tipsId: string;
  tips: ReadonlyArray<{ icon: string; text: string }>;
  payload: CanvasPayload | null;
  canvasTitle: string;
  /** More text for the empty inspector. */
  emptyExtra?: string | undefined;
}>();
const emit = defineEmits<{ reset: [] }>();
const breakpoint = defineModel<BlockBreakpoint>('breakpoint', { required: true });
const locale = defineModel<string>('locale', { required: true });
const exact = defineModel<boolean>('exact', { required: true });

const spaces = useSpaceStore();
const { settings, designed, canRead, canPublish, canSwitch, canvasOrigin } = useSiteContext();
const { designKind, root, theme, locales, readOnly } = useDesignerContext();
const query = computed(() => props.draft.query);
const selected = computed(() => props.designer.selected.value);
const status = computed(() => query.value.data.value?.status ?? 'generated');

useEditorShortcuts({
  save: () => void props.draft.save(),
  undo: () => props.draft.undo(),
  redo: () => props.draft.redo(),
  canUndo: () => props.draft.canUndo.value,
  canRedo: () => props.draft.canRedo.value,
});

function retry() {
  void settings.refetch();
  void query.value.refetch();
  void props.themeQuery.refetch();
}
</script>

<template>
  <PageState
    class="ws:h-full"
    :loading="settings.isPending.value || (designed && (query.isPending.value || themeQuery.isPending.value))"
    :error="settings.error.value ?? query.error.value ?? themeQuery.error.value"
    :retry="retry"
    :loading-label="loadingLabel"
  >
    <div v-if="!canRead" class="mb-page-wide">
      <EmptyState icon="lock" title="No access to the design" description="Someone who manages this space's roles can give you design rights." />
    </div>

    <div v-else-if="!designed && spaces.currentId && settings.data.value" class="mb-page-wide ws:space-y-4">
      <EditorHeader :title="kind" eyebrow="Design" />
      <SiteModePanel :space-id="spaces.currentId" :mode="settings.data.value.mode" :can-switch="canSwitch" :frontend-url="spaces.current?.url" />
    </div>

    <div v-else-if="missing" class="mb-page-wide">
      <slot name="missing" />
    </div>

    <DesignerLayout v-else-if="root && theme && spaces.currentId">
      <template #toolbar>
        <DesignerToolbar :title="title" :kind="kind" :icon="icon" :back="back" :status="status" :read-only="readOnly">
          <DesignerActions :draft="draft" :status="status" :what="what" :read-only="readOnly" :can-publish="canPublish">
            <slot name="actions" />
            <template v-if="!readOnly" #more>
              <button type="button" class="mb-menu-item ws:w-full" @click="emit('reset')">
                <Icon name="reset" class="mb-icon-sm" /> {{ resetLabel }}
              </button>
            </template>
          </DesignerActions>
        </DesignerToolbar>
      </template>

      <template #notices>
        <DesignDraftNotices :draft="draft" :what="`this ${kind.toLowerCase()}`" />
      </template>

      <template #left>
        <DesignerElementsPane :designer="designer" :design-kind="designKind" :unavailable="unavailable" :read-only="readOnly">
          <template v-if="$slots['elements-top']" #top>
            <slot name="elements-top" />
          </template>
        </DesignerElementsPane>
      </template>

      <template #center>
        <DesignerTips v-if="!readOnly" :id="tipsId" :tips="tips" />
        <div class="ws:min-h-0 ws:flex-1">
          <DesignCanvas
            v-model:breakpoint="breakpoint"
            flush
            :site-url="canvasOrigin"
            :payload="payload"
            :highlight="designer.highlight.value"
            :read-only="readOnly"
            :title="canvasTitle"
            @select-node="designer.canvas.selectNode"
            @hover-node="designer.canvas.hoverNode"
            @move-node="designer.canvas.moveNode"
            @insert-node="designer.canvas.insertNode"
            @remove-node="designer.canvas.removeNode"
            @edit-text="designer.canvas.editText"
            @resize-node="designer.canvas.resizeNode"
          >
            <template #tools>
              <DesignerCanvasTools v-model:locale="locale" v-model:exact="exact" :locales="locales" :read-only="readOnly">
                <template v-if="$slots['canvas-note']" #default>
                  <slot name="canvas-note" />
                </template>
              </DesignerCanvasTools>
            </template>
          </DesignCanvas>
        </div>
      </template>

      <template #right>
        <NodeInspector
          v-if="selected"
          :key="selected.node.id"
          :node="selected.node"
          @update="(next, group) => designer.patch(selected!.node.id, () => next, group)"
        />
        <InspectorEmpty v-else :read-only="readOnly" :extra="emptyExtra" />
        <slot name="panes" />
      </template>
    </DesignerLayout>
  </PageState>
</template>
