<script setup lang="ts">
import {
  EditorHeader,
  EmptyState,
  FeatureLock,
  Icon,
  IconButton,
  PageState,
  requireSpace,
  runWrite,
  StatusBadge,
  shortcutHint,
  Tabs,
  useCan,
  useEditorShortcuts,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { PageDesign, SiteSettingsDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import DesignDraftNotices from '../components/DesignDraftNotices.vue';
import SiteCodePanel from '../components/SiteCodePanel.vue';
import SiteGeneralPanel from '../components/SiteGeneralPanel.vue';
import SiteLayoutsPanel from '../components/SiteLayoutsPanel.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import SiteSeoPanel from '../components/SiteSeoPanel.vue';
import { isDirty, STATUS_META } from '../model/status';
import { design, useDesignsData, useSiteDesigns } from '../queries';
import { useDesignDraft } from '../useDesignDraft';
import { useSiteContext } from '../useSiteContext';

/** Site-wide settings of the designed site: identity, search defaults, layouts, code. */
const spaces = useSpaceStore();
const site = useSiteContext();
const { settings, designed, canRead, canWrite, canPublish, canSwitch, designLocked } = site;
const canCode = useCan('website:code');
const readOnly = computed(() => !canWrite.value);

const draftState = useDesignDraft('site', 'default', { readOnly });
const { draft, query } = draftState;
useEditorShortcuts({
  save: () => void draftState.save(),
  undo: draftState.undo,
  redo: draftState.redo,
  canUndo: () => draftState.canUndo.value,
  canRedo: () => draftState.canRedo.value,
});

const designs = useSiteDesigns();
const layouts = computed(() =>
  (designs.data.value ?? [])
    .filter((entry) => entry.kind === 'layout')
    .map((entry) => ({ key: entry.key, label: entry.label })),
);
const storedPages = computed(() =>
  (designs.data.value ?? [])
    .filter((entry) => entry.kind === 'page' && entry.id !== null)
    .map((entry) => entry.key),
);
const pageData = useDesignsData('page', storedPages);
/** Layouts page designs pick themselves, by content type id; those win over this tab. */
const pagePicks = computed(() => {
  const out: Record<string, string> = {};
  for (const [typeId, data] of Object.entries(pageData.data.value ?? {})) {
    const layout = (data as PageDesign | null)?.layout;
    if (layout) out[typeId] = layout;
  }
  return out;
});

type Tab = 'general' | 'search' | 'layouts' | 'code';
const TABS = [
  { id: 'general', label: 'General' },
  { id: 'search', label: 'Search and sharing' },
  { id: 'layouts', label: 'Layouts' },
  { id: 'code', label: 'Custom code' },
] as const;
const tab = ref<Tab>('general');

function update(next: SiteSettingsDesign, group?: string) {
  draftState.update(next, group);
}

const status = computed(() => query.data.value?.status ?? 'generated');
const savedLabel = computed(() => {
  if (draftState.saving.value) return 'Saving...';
  if (draftState.isDirty.value) return readOnly.value ? '' : 'Unsaved';
  return draftState.lastSavedAt.value ? 'Saved' : '';
});

const publishing = ref(false);
const canPublishNow = computed(
  () => canPublish.value && (draftState.isDirty.value || isDirty(status.value)),
);
async function publish() {
  await runWrite(
    async () => {
      if (!(await draftState.save())) throw new Error('Save the settings before publishing.');
      const id = query.data.value?.design?.id;
      if (!id) throw new Error('Nothing to publish yet.');
      await design.publish(requireSpace(), id);
    },
    { busy: publishing, success: 'Published the site settings' },
  );
}

function retry() {
  void settings.refetch();
  void query.refetch();
}
</script>

<template>
  <PageState
    :loading="settings.isPending.value || (designed && query.isPending.value)"
    :error="settings.error.value ?? query.error.value"
    :retry="retry"
    loading-label="Loading the site settings..."
  >
    <div class="mb-page">
      <EmptyState v-if="!canRead" icon="lock" title="No access to the design" description="Someone who manages this space's roles can give you design rights." />

      <div v-else-if="!designed && spaces.currentId && settings.data.value" class="ws:space-y-4">
        <EditorHeader title="Site settings" eyebrow="Design" />
        <SiteModePanel :space-id="spaces.currentId" :mode="settings.data.value.mode" :can-switch="canSwitch" :frontend-url="spaces.current?.url" />
      </div>

      <template v-else-if="draft && spaces.currentId && settings.data.value">
        <EditorHeader title="Site settings" eyebrow="Design">
          <template #badge>
            <StatusBadge v-if="readOnly" status="read-only" />
            <FeatureLock v-if="designLocked" feature="plugins.website.design" label="Designing is locked" />
            <span :class="STATUS_META[status].tone" :title="STATUS_META[status].hint">{{ STATUS_META[status].label }}</span>
          </template>
          <span class="mb-meta" aria-live="polite">{{ savedLabel }}</span>
          <IconButton icon="undo" label="Undo" size="md" :disabled="!draftState.canUndo.value" :title="shortcutHint('mod+z', 'Undo')" @click="draftState.undo()" />
          <IconButton icon="redo" label="Redo" size="md" :disabled="!draftState.canRedo.value" :title="shortcutHint('shift+mod+z', 'Redo')" @click="draftState.redo()" />
          <RouterLink to="/settings?tab=general" class="mb-btn-outline" aria-label="Website settings">
            <Icon name="settings" class="mb-icon" /> Website settings
          </RouterLink>
          <RouterLink to="/redirects" class="mb-btn-outline" aria-label="Redirects">
            <Icon name="link" class="mb-icon" /> Redirects
          </RouterLink>
          <button v-if="canPublish" type="button" class="mb-btn-primary" :disabled="publishing || !canPublishNow" @click="publish">
            <Icon name="upload" /> {{ publishing ? 'Publishing...' : 'Publish' }}
          </button>
        </EditorHeader>

        <DesignDraftNotices :draft="draftState" what="the site settings" />

        <p class="mb-hint ws:mb-4">
          Changes save as a draft and reach the site when you publish them, here or with Publish all
          on the <RouterLink to="/design" class="ws:underline">design overview</RouterLink>. The 404 page,
          languages and password are under Settings, General, and domains under Settings, API hosts;
          they apply at once.
        </p>

        <section class="mb-card ws:space-y-4">
          <Tabs v-model="tab" :tabs="TABS" aria-label="Site settings" />
          <SiteGeneralPanel v-if="tab === 'general'" :site="draft" :read-only="readOnly" @update="update" />
          <SiteSeoPanel v-else-if="tab === 'search'" :site="draft" :read-only="readOnly" @update="update" />
          <SiteLayoutsPanel v-else-if="tab === 'layouts'" :site="draft" :layouts="layouts" :page-picks="pagePicks" :read-only="readOnly" @update="update" />
          <SiteCodePanel v-else :site="draft" :can-code="canCode" :read-only="readOnly" @update="update" />
        </section>
      </template>
    </div>
  </PageState>
</template>
