<script setup lang="ts">
import { confirm, EmptyState, useSpaceStore } from '@manablox/admin-sdk';
import type { BlockBreakpoint } from '@manablox/core';
import {
  collectNodeIds,
  generateLayout,
  type LayoutDesign,
  type ThemeDesign,
  validateSiteDesign,
} from '@manablox/site';
import { computed, ref } from 'vue';
import { metaFields } from '../model/bindings';
import { slotDuplicateError, slotInsertError, slotRemovalError } from '../model/layout-design';
import { nodeAtPath } from '../model/outline';
import { sampleDocument, samplePage } from '../model/site-preview';
import { useSiteDesign, useSiteDesigns } from '../queries';
import { useDesignDraft } from '../useDesignDraft';
import { useDesigner } from '../useDesigner';
import { useDesignPreview } from '../useDesignPreview';
import { useSiteContext } from '../useSiteContext';
import DesignerShell from './DesignerShell.vue';
import DesignWarnings from './DesignWarnings.vue';
import PaneSection from './PaneSection.vue';

/** The layout designer: header, menus and footer around the page's `slot`. */
const props = defineProps<{
  designKey: string;
  /** Menus of the space, for the generated `default` layout. */
  menus: ReadonlyArray<{ machineName: string; name?: string }>;
}>();
const spaces = useSpaceStore();
const { canWrite } = useSiteContext();
const readOnly = computed(() => !canWrite.value);

const key = computed(() => props.designKey);
const fields = metaFields('layout');

const layout = useDesignDraft('layout', key, {
  readOnly,
  fallback: () =>
    key.value === 'default' && spaces.current
      ? generateLayout(
          { name: spaces.current.name, defaultLocale: spaces.current.defaultLocale },
          props.menus,
        )
      : null,
});
const { draft, query } = layout;
const themeQuery = useSiteDesign('theme', 'default');
const theme = computed(() => (themeQuery.data.value?.data as ThemeDesign | undefined) ?? null);
const designs = useSiteDesigns();
const name = computed(
  () =>
    (designs.data.value ?? []).find((entry) => entry.kind === 'layout' && entry.key === key.value)
      ?.label ?? key.value,
);
const exists = computed(() => key.value === 'default' || Boolean(query.data.value?.design));

const root = computed(() => draft.value?.root ?? null);
function updateLayout(next: LayoutDesign, group?: string) {
  layout.update(next, group);
}

const breakpoint = ref<BlockBreakpoint>('desktop');
const exactSizes = ref(false);
const locale = ref(spaces.locale);
const locales = computed(() => spaces.current?.locales ?? [locale.value]);

const designer = useDesigner({
  designKind: 'layout',
  designKey: () => key.value,
  root: () => root.value,
  setRoot: (next, group) => updateLayout({ root: next }, group),
  fields: () => fields,
  locale: () => locale.value,
  locales: () => locales.value,
  theme: () => theme.value,
  breakpoint: () => breakpoint.value,
  advanced: () => exactSizes.value,
  readOnly: () => readOnly.value,
  takenIds: () => (root.value ? collectNodeIds(root.value) : new Set()),
  refuse: {
    remove: slotRemovalError,
    duplicate: slotDuplicateError,
    insert: (tree, kind) => (kind === 'slot' ? slotInsertError(tree) : null),
  },
});

const unavailable = computed(() => {
  const out: Record<string, string> = { ...designer.formUnavailable.value };
  const slot = slotInsertError(root.value);
  if (slot) out.slot = slot;
  for (const kind of ['repeat', 'blocks', 'block', 'template'] as const)
    out[kind] = 'Layouts show no content fields; the page design does.';
  return out;
});

const preview = useDesignPreview({
  locale: () => locale.value,
  theme: () => theme.value,
  page: () => ({ key: 'sample', design: samplePage(locale.value) }),
  layout: () => (draft.value ? { key: key.value, design: draft.value } : null),
  document: () => sampleDocument('sample'),
  documentType: () => null,
  sample: () => true,
  focus: () => ({ kind: 'layout', key: key.value }),
});

const issues = computed(() => {
  if (!draft.value) return [];
  const result = validateSiteDesign('layout', draft.value);
  return result.ok ? [] : result.issues;
});

function selectIssue(path: string) {
  if (root.value) designer.select(nodeAtPath(root.value, path));
}

async function resetToGenerated() {
  const space = spaces.current;
  if (!space) return;
  const ok = await confirm({
    title: 'Start over from the generated layout?',
    message:
      'The elements are replaced with a header with logo and main menu, the page, and a footer. Undo brings them back.',
    confirmLabel: 'Start over',
  });
  if (ok)
    updateLayout(
      generateLayout({ name: space.name, defaultLocale: space.defaultLocale }, props.menus),
    );
}
</script>

<template>
  <DesignerShell
    v-model:breakpoint="breakpoint"
    v-model:locale="locale"
    v-model:exact="exactSizes"
    :designer="designer"
    :draft="layout"
    :theme-query="themeQuery"
    loading-label="Loading the layout..."
    :missing="!exists"
    :title="name"
    kind="Layout"
    icon="panels-top-left"
    :back="{ to: '/design/layouts', label: 'Layouts' }"
    :what="`the layout &quot;${name}&quot;`"
    reset-label="Start over with header and footer"
    :unavailable="unavailable"
    tips-id="layout"
    :tips="[
      { icon: 'doc', text: 'The sample page stands in for every page' },
      { icon: 'plus', text: 'Menus and the logo are under Add, Site' },
      { icon: 'upload', text: 'Drafts save by themselves; Publish makes them live' },
    ]"
    :payload="preview.payload.value"
    :canvas-title="`Layout ${name}`"
    empty-extra="Layouts have exactly one Page content element: where each page goes."
    @reset="resetToGenerated"
  >
    <template #missing>
      <EmptyState icon="panels-top-left" title="No such layout" description="It may have been deleted. Create layouts under Layouts.">
        <RouterLink to="/design/layouts" class="mb-btn-outline">All layouts</RouterLink>
      </EmptyState>
    </template>

    <template #panes>
      <PaneSection id="checks" title="Checks" icon="list-checks" :summary="issues.length ? `${issues.length} to look at` : 'all good'" :summary-tone="issues.length ? 'warn' : 'ok'">
        <DesignWarnings :unplaced="[]" :broken="[]" :issues="issues" :read-only="readOnly" @select-issue="selectIssue" />
      </PaneSection>
    </template>
  </DesignerShell>
</template>
