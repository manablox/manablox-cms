<script setup lang="ts">
import {
  EditorHeader,
  EmptyState,
  PageState,
  Tabs,
  useEditorShortcuts,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import type { ThemeDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import AiThemeButton from '../components/AiThemeButton.vue';
import DesignCanvas from '../components/DesignCanvas.vue';
import DesignDraftNotices from '../components/DesignDraftNotices.vue';
import DesignerActions from '../components/DesignerActions.vue';
import DesignerLayout from '../components/DesignerLayout.vue';
import DesignerTips from '../components/DesignerTips.vue';
import DesignerToolbar from '../components/DesignerToolbar.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import ThemeColorsPanel from '../components/ThemeColorsPanel.vue';
import ThemeElementsPanel from '../components/ThemeElementsPanel.vue';
import ThemeFontsPanel from '../components/ThemeFontsPanel.vue';
import ThemeScalesPanel from '../components/ThemeScalesPanel.vue';
import ThemeTypePanel from '../components/ThemeTypePanel.vue';
import { compileDraftCss } from '../model/canvas';
import { styleGuideInput } from '../model/style-guide';
import { useCanvasAssets } from '../useCanvasAssets';
import type { CanvasPayload } from '../useDesignCanvas';
import { useDesignDraft } from '../useDesignDraft';
import { useSiteContext } from '../useSiteContext';

/** The theme editor: tokens and base styles on the left, the live style guide on the right. */
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canWrite, canPublish, canSwitch, canvasOrigin } = site;
const readOnly = computed(() => !canWrite.value);

const theme = useDesignDraft('theme', 'default', { readOnly });
const { draft, query } = theme;
useEditorShortcuts({
  save: () => void theme.save(),
  undo: theme.undo,
  redo: theme.redo,
  canUndo: () => theme.canUndo.value,
  canRedo: () => theme.canRedo.value,
});

type Tab = 'colors' | 'fonts' | 'type' | 'spacing' | 'elements';
const TABS = [
  { id: 'colors', label: 'Colors' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'type', label: 'Text' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'elements', label: 'Elements' },
] as const;
const tab = ref<Tab>('colors');
const breakpoint = ref<BlockBreakpoint>('desktop');

function update(next: ThemeDesign, group?: string) {
  theme.update(next, group);
}

const assets = useCanvasAssets(() => draft.value);
const payload = computed<CanvasPayload | null>(() => {
  const current = draft.value;
  const space = spaces.current;
  if (!current || !space) return null;
  const input = styleGuideInput(current, {
    id: space.id,
    name: space.name,
    defaultLocale: space.defaultLocale,
    locales: space.locales,
  });
  const css = compileDraftCss(
    current,
    [
      { kind: 'page', key: input.page.key, data: input.page.design },
      { kind: 'layout', key: input.layout.key, data: input.layout.design },
    ],
    assets.value,
  );
  return { input, css, focus: null };
});

function retry() {
  void settings.refetch();
  void query.refetch();
}

const status = computed(() => query.data.value?.status ?? 'generated');

/** A sentence per tab, above its settings. */
const TAB_INTROS: Record<Tab, string> = {
  colors: 'The colors the whole site uses. Change one here and every page and block follows.',
  fonts: 'The typefaces of the site. Pick from the built-in fonts or add your own.',
  type: 'Sizes and weights of headings and body text.',
  spacing: 'The steps of space between and inside elements, and the widths of content.',
  elements: 'How buttons, links and form fields look everywhere on the site.',
};
</script>

<template>
  <PageState
    class="ws:h-full"
    :loading="settings.isPending.value || (designed && query.isPending.value)"
    :error="settings.error.value ?? query.error.value"
    :retry="retry"
    loading-label="Loading the theme..."
  >
    <div v-if="!canRead" class="mb-page-wide">
      <EmptyState icon="lock" title="No access to the design" description="Someone who manages this space's roles can give you design rights." />
    </div>

    <div v-else-if="!designed && spaces.currentId && settings.data.value" class="mb-page-wide ws:space-y-4">
      <EditorHeader title="Theme" eyebrow="Design" />
      <SiteModePanel :space-id="spaces.currentId" :mode="settings.data.value.mode" :can-switch="canSwitch" :frontend-url="spaces.current?.url" />
    </div>

    <DesignerLayout v-else-if="draft && spaces.currentId" left-label="Theme settings">
      <template #toolbar>
        <DesignerToolbar title="Theme" kind="Colors, fonts and spacing" icon="palette" :back="{ to: '/design', label: 'Overview' }" :status="status" :read-only="readOnly">
          <DesignerActions :draft="theme" :status="status" what="the theme" :read-only="readOnly" :can-publish="canPublish">
            <AiThemeButton v-if="!readOnly" :space-id="spaces.currentId" :theme="draft" @apply="update" />
          </DesignerActions>
        </DesignerToolbar>
      </template>

      <template #notices>
        <DesignDraftNotices :draft="theme" what="the theme" />
      </template>

      <template #left>
        <Tabs v-model="tab" :tabs="TABS" aria-label="Theme" />
        <p class="mb-meta">{{ TAB_INTROS[tab] }}</p>
        <ThemeColorsPanel v-if="tab === 'colors'" :colors="draft.colors" :read-only="readOnly" @update="(colors, group) => update({ ...draft!, colors }, group)" />
        <ThemeFontsPanel v-else-if="tab === 'fonts'" :fonts="draft.fonts" :space-id="spaces.currentId" :read-only="readOnly" @update="(fonts, group) => update({ ...draft!, fonts }, group)" />
        <ThemeTypePanel v-else-if="tab === 'type'" :theme="draft" :read-only="readOnly" @update="update" />
        <ThemeScalesPanel v-else-if="tab === 'spacing'" :theme="draft" :read-only="readOnly" @update="update" />
        <ThemeElementsPanel v-else :theme="draft" :breakpoint="breakpoint" :read-only="readOnly" @update="update" />
      </template>

      <template #center>
        <DesignerTips
          v-if="!readOnly"
          id="theme"
          :tips="[
            { icon: 'eye', text: 'The style guide on the right shows every change at once' },
            { icon: 'smartphone', text: 'Switch the device above the preview to check phones' },
            { icon: 'upload', text: 'Drafts save by themselves; Publish makes them live' },
          ]"
        />
        <div class="ws:min-h-0 ws:flex-1">
          <DesignCanvas v-model:breakpoint="breakpoint" flush :site-url="canvasOrigin" :payload="payload" read-only title="Style guide">
            <template #tools>
              <span class="ws:truncate ws:text-2xs ws:text-surface-500">Style guide: how the theme looks on real elements</span>
            </template>
          </DesignCanvas>
        </div>
      </template>
    </DesignerLayout>
  </PageState>
</template>
