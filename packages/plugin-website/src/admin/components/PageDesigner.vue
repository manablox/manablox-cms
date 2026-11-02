<script setup lang="ts">
import { confirm, EmptyState, useContentByIds, useSpaceStore } from '@manablox/admin-sdk';
import type { BlockBreakpoint, ContentTypeDefinition } from '@manablox/core';
import {
  collectNodeIds,
  type DesignNode,
  findBrokenBindings,
  findUnplacedFields,
  generatePageDesign,
  type PageDesign,
  type SiteSettingsDesign,
  type ThemeDesign,
  validateSiteDesign,
} from '@manablox/site';
import { computed, ref } from 'vue';
import { bindingOptions, metaFields, repeatScope, withRelated } from '../model/bindings';
import { nodeAtPath } from '../model/outline';
import { pageSampleDocument, pageSeoIssues } from '../model/page-design';
import { useSiteDesign, useSiteDesigns } from '../queries';
import { useDesignDraft } from '../useDesignDraft';
import { useDesigner } from '../useDesigner';
import { useDesignPreview } from '../useDesignPreview';
import { useSiteContext } from '../useSiteContext';
import DesignerShell from './DesignerShell.vue';
import DesignWarnings from './DesignWarnings.vue';
import PageSamplePicker from './PageSamplePicker.vue';
import PageSettingsSection from './PageSettingsSection.vue';
import PaneSection from './PaneSection.vue';

/** The page designer: the element tree a content type's pages render with, inside its layout. */
const props = defineProps<{ typeId: string }>();
const spaces = useSpaceStore();
const { canWrite } = useSiteContext();
const readOnly = computed(() => !canWrite.value);

const typeId = computed(() => props.typeId);
const type = computed(() => {
  const found = spaces.typeById(typeId.value);
  return found?.kind === 'content' && !found.isSystem ? found : null;
});
const typeFields = computed(() => withRelated(type.value?.fields ?? [], spaces.typeById));
const fields = computed(() => [...metaFields('page'), ...typeFields.value]);

const page = useDesignDraft('page', typeId, {
  readOnly,
  fallback: () => (type.value ? generatePageDesign(type.value) : null),
});
const { draft } = page;
const themeQuery = useSiteDesign('theme', 'default');
const theme = computed(() => (themeQuery.data.value?.data as ThemeDesign | undefined) ?? null);
const siteQuery = useSiteDesign('site', 'default');
const siteDesign = computed(
  () => (siteQuery.data.value?.data as SiteSettingsDesign | undefined) ?? null,
);
const designs = useSiteDesigns();
const layouts = computed(() =>
  (designs.data.value ?? [])
    .filter((entry) => entry.kind === 'layout')
    .map((entry) => ({ key: entry.key, label: entry.label })),
);

const root = computed(() => draft.value?.root ?? null);
function updatePage(next: PageDesign, group?: string) {
  page.update(next, group);
}

const breakpoint = ref<BlockBreakpoint>('desktop');
const exactSizes = ref(false);
const locale = ref(spaces.locale);
const locales = computed(() => spaces.current?.locales ?? [locale.value]);

const designer = useDesigner({
  designKind: 'page',
  designKey: () => typeId.value,
  root: () => root.value,
  setRoot: (next, group) => {
    if (draft.value) updatePage({ ...draft.value, root: next }, group);
  },
  fields: () => fields.value,
  locale: () => locale.value,
  locales: () => locales.value,
  theme: () => theme.value,
  breakpoint: () => breakpoint.value,
  advanced: () => exactSizes.value,
  readOnly: () => readOnly.value,
  takenIds: () => (root.value ? collectNodeIds(root.value) : new Set()),
});
const { selected } = designer;

const unavailable = computed(() => {
  const tree = root.value;
  if (!tree) return {};
  const parentId = selected.value?.parent?.id ?? tree.id;
  const scope = repeatScope(tree, parentId);
  const out: Record<string, string> = { ...designer.formUnavailable.value };
  for (const kind of ['repeat', 'blocks', 'block', 'template'] as const) {
    if (bindingOptions(typeFields.value, kind, scope).length === 0)
      out[kind] = `No field of this content type fits a ${kind} element here.`;
  }
  return out;
});

// Sample content.
const sampleId = ref<string | null>(null);
const sampleRows = useContentByIds(() => (sampleId.value ? [sampleId.value] : []));
const sampleRow = computed(() => sampleRows.data.value?.[0] ?? null);
const document = computed(() =>
  pageSampleDocument(
    typeId.value,
    typeFields.value,
    sampleId.value ? sampleRow.value : null,
    spaces.dataKinds[0]?.id ?? null,
  ),
);

const preview = useDesignPreview({
  locale: () => locale.value,
  theme: () => theme.value,
  page: () => (draft.value ? { key: typeId.value, design: draft.value } : null),
  document: () => document.value,
  documentType: () => type.value,
  sample: () => !sampleId.value,
  focus: () => ({ kind: 'page', key: typeId.value }),
});

// Checks.
const unplaced = computed(() =>
  draft.value && type.value ? findUnplacedFields(draft.value, type.value) : [],
);
const broken = computed(() =>
  draft.value && type.value ? findBrokenBindings(draft.value, type.value) : [],
);
const issues = computed(() => {
  if (!draft.value) return [];
  const result = validateSiteDesign('page', draft.value);
  return result.ok ? [] : result.issues;
});
const notes = computed(() => (draft.value ? pageSeoIssues(draft.value, typeFields.value) : []));

function selectIssue(path: string) {
  if (root.value) designer.select(nodeAtPath(root.value as DesignNode, path));
}

const checkCount = computed(
  () => unplaced.value.length + broken.value.length + issues.value.length + notes.value.length,
);

async function resetToGenerated() {
  if (!type.value || !draft.value) return;
  const ok = await confirm({
    title: 'Start over from the fields?',
    message:
      'The elements are replaced with the design generated from the content type; the layout and search settings stay. Undo brings it back.',
    confirmLabel: 'Start over',
  });
  if (!ok) return;
  const generated = generatePageDesign(type.value);
  updatePage({ ...draft.value, root: generated.root });
}
</script>

<template>
  <DesignerShell
    v-model:breakpoint="breakpoint"
    v-model:locale="locale"
    v-model:exact="exactSizes"
    :designer="designer"
    :draft="page"
    :theme-query="themeQuery"
    loading-label="Loading the page design..."
    :missing="!type"
    :title="type?.label ?? ''"
    kind="Page design"
    icon="doc"
    :back="{ to: '/design/pages', label: 'Pages' }"
    :what="`the page design of &quot;${type?.label}&quot;`"
    reset-label="Start over from the fields"
    :unavailable="unavailable"
    tips-id="elements"
    :tips="[
      { icon: 'mouse-pointer-2', text: 'Click the preview to select, change it on the right' },
      { icon: 'plus', text: 'Drag new elements in from Add' },
      { icon: 'upload', text: 'Drafts save by themselves; Publish makes them live' },
    ]"
    :payload="preview.payload.value"
    :canvas-title="`Page design of ${type?.label}`"
    @reset="resetToGenerated"
  >
    <template #missing>
      <EmptyState icon="doc" title="No such content type" description="It may have been deleted, or it is a block or databag type.">
        <RouterLink to="/design/pages" class="mb-btn-outline">All page designs</RouterLink>
      </EmptyState>
    </template>

    <template #canvas-note>
      <template v-if="sampleId && sampleRow">Showing "{{ sampleRow.title }}"</template>
    </template>

    <template #panes>
      <PaneSection v-if="draft" id="page-settings" title="Page settings" icon="settings" summary="layout, search, sharing">
        <PageSettingsSection
          :page="draft"
          :fields="typeFields"
          :layouts="layouts"
          :site-layout="siteDesign?.layouts?.[typeId] ?? 'default'"
          :read-only="readOnly"
          @update="updatePage"
        />
      </PaneSection>
      <PaneSection id="sample" title="Preview content" icon="eye" :summary="sampleId ? 'a real page' : 'sample text'">
        <p class="mb-meta">What the preview fills the fields with. Nothing here is saved.</p>
        <PageSamplePicker v-model="sampleId" :type-id="typeId" :title="sampleRow?.title ?? null" />
      </PaneSection>
      <PaneSection id="checks" title="Checks" icon="list-checks" :summary="checkCount ? `${checkCount} to look at` : 'all good'" :summary-tone="checkCount ? 'warn' : 'ok'">
        <DesignWarnings
          :unplaced="unplaced"
          :broken="broken"
          :issues="issues"
          :notes="notes"
          owner="content type"
          :read-only="readOnly"
          @place-field="designer.insertField"
          @select-node="designer.select"
          @select-issue="selectIssue"
        />
      </PaneSection>
    </template>
  </DesignerShell>
</template>
