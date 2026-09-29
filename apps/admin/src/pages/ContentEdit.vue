<script setup lang="ts">
import Icon from '@manablox/admin-sdk/components/Icon.vue';
import EditorHeader from '@manablox/admin-sdk/components/layout/EditorHeader.vue';
import PageState from '@manablox/admin-sdk/components/ui/PageState.vue';
import SaveButton from '@manablox/admin-sdk/components/ui/SaveButton.vue';
import { useMenusFor } from '@manablox/admin-sdk/features/menus/queries';
import { useCan, useFeature } from '@manablox/admin-sdk/lib/space';
import { typeIcon } from '@manablox/admin-sdk/lib/type-icon';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, defineAsyncComponent, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import EditorLayout from '~/components/layout/EditorLayout.vue';
import PluginSlot from '~/components/PluginSlot';
import { useFocusFirstField } from '~/composables/useFocusFirstField';
import ApprovalSection from '~/features/content/components/ApprovalSection.vue';
import ContentHeaderTools from '~/features/content/components/ContentHeaderTools.vue';
import ContentPlacementSection from '~/features/content/components/ContentPlacementSection.vue';
import ContentStatusBadges from '~/features/content/components/ContentStatusBadges.vue';
import ContentTagsSection from '~/features/content/components/ContentTagsSection.vue';
import ContentTitleSection from '~/features/content/components/ContentTitleSection.vue';
import DraftConflictNotices from '~/features/content/components/DraftConflictNotices.vue';
import FieldGrid from '~/features/content/components/FieldGrid.vue';
import PublishControls from '~/features/content/components/PublishControls.vue';
import TranslationSwitcher from '~/features/content/components/TranslationSwitcher.vue';
import VersionHistory from '~/features/content/components/VersionHistory.vue';
import { editorDraftOf } from '~/features/content/editor-draft';
import { useContentLoader } from '~/features/content/useContentLoader';
import { useContentRoute } from '~/features/content/useContentRoute';
import { useContentSave } from '~/features/content/useContentSave';
import { useDocumentFieldContext } from '~/features/content/useDocumentFieldContext';
import { useDraftStore } from '~/features/content/useDraftStore';
import MenuAssignDialog from '~/features/menus/components/MenuAssignDialog.vue';

const router = useRouter();
const draft = useDraftStore();
const spaces = useSpaceStore();

const showHistory = ref(false);
const showVisual = ref(false);
const VisualEditor = defineAsyncComponent(
  () => import('~/features/content/components/VisualEditor.vue'),
);
/** The plugin editor view open over the page, by its slot key. */
const openView = ref<string | null>(null);
const closeView = () => {
  openView.value = null;
};

const contentType = computed(() => (draft.doc ? spaces.typeById(draft.doc.typeId) : null));

// Needs a block canvas and a framable page, so never for templates.
const hasBlockField = computed(
  () =>
    Boolean(contentType.value?.hasSlug) &&
    (contentType.value?.fields ?? []).some((field) => spaces.fieldTypeMeta(field.type)?.nested),
);

const { section, isNewRoute, backLabel } = useContentRoute();
const canWrite = useCan('content:write', () => draft.doc?.typeId);
const canPublish = useCan('content:publish', () => draft.doc?.typeId);
const approvalsFeature = useFeature('approvals');
/** Only saved documents of a reviewed type; a locked switch keeps open requests decidable. */
const showApproval = computed(
  () =>
    Boolean(draft.doc?.id) &&
    Boolean(contentType.value?.requiresApproval) &&
    !approvalsFeature.value.hidden,
);

// Only new documents focus the title.
const editor = useTemplateRef<HTMLElement>('editor');
useFocusFirstField(editor, isNewRoute);

/** Server publish state; the draft holds only editable fields. */
const {
  status,
  isPublished,
  savedSincePublish,
  schedule,
  showSchedule,
  savingSchedule,
  scheduled,
  canPublishNow,
  reset: resetPublishing,
  adopt: adoptPublishing,
  publish,
  unpublish,
  saveSchedule,
  save,
  onApproved,
  duplicating,
  duplicate,
  remove,
} = useContentSave({
  draft,
  editor,
  router,
  section: () => section.value,
  isNew: () => isNewRoute.value,
  canPublish: () => canPublish.value,
  isPublishable: () => contentType.value?.isPublishable ?? false,
});

/** The draft as plugin views see it. */
const editorDraft = editorDraftOf(draft, { readOnly: () => !canWrite.value, save: () => save() });

const {
  loading,
  error: loadError,
  notFound,
  localizationId,
  load,
  retry,
} = useContentLoader({
  draft,
  section: () => section.value,
  isNew: () => isNewRoute.value,
  onBlank: resetPublishing,
  // A later `updatedAt` means saved since publishing.
  onLoaded: adoptPublishing,
});
const { data: usedIn } = useMenusFor(localizationId);
const assigningMenus = ref(false);

const { mainFields, sidebarFields } = useDocumentFieldContext({ contentType, canWrite });

/** One field changed. */
function setField(name: string, value: unknown) {
  if (draft.doc) draft.doc.fields[name] = value;
}
</script>

<template>
  <div class="h-full">
    <!-- Single root; a top-level comment would make a fragment the transition cannot animate. -->
    <PageState
      class="h-full"
      :loading="loading"
      :error="loadError"
      :retry="retry"
      :not-found="notFound"
      loading-label="Loading document..."
      not-found-title="Document not found"
      not-found-icon="files"
      :back-to="section"
      :back-label="backLabel"
    >
    <div v-if="draft.doc && contentType" ref="editor" class="flex h-full flex-col">
      <EditorHeader sticky :title="draft.doc.title || 'Untitled'" :eyebrow="contentType.label" :eyebrow-icon="typeIcon(contentType)">
        <template #badge>
          <ContentStatusBadges
            :status="status"
            :is-published="isPublished"
            :saved-since-publish="savedSincePublish"
            :scheduled="scheduled"
            :schedule="schedule"
          />
        </template>

        <ContentHeaderTools
          v-model:history="showHistory"
          :content-type="contentType"
          :editor-draft="editorDraft"
          :has-block-field="hasBlockField"
          :close-view="closeView"
          @visual="showVisual = true"
          @view="openView = $event"
        />

        <TranslationSwitcher v-if="draft.doc.id" :space-id="draft.doc.spaceId" :content-id="draft.doc.id" />

        <span class="mx-1 hidden h-5 w-px bg-surface-200 sm:block dark:bg-surface-800" aria-hidden="true" />

        <SaveButton v-if="canWrite" variant="outline" :saving="draft.saving" :disabled="!draft.isDirty" @click="save" />
        <PublishControls
          v-if="canPublish && contentType.isPublishable"
          v-model:show-schedule="showSchedule"
          :is-published="isPublished"
          :can-publish-now="canPublishNow"
          :scheduled="scheduled"
          :schedule="schedule"
          :saving-schedule="savingSchedule"
          :saved="Boolean(draft.doc.id)"
          @publish="publish"
          @unpublish="unpublish"
          @save-schedule="saveSchedule"
        />
        <button
          v-if="draft.doc.id && canWrite"
          class="mb-btn-ghost"
          :disabled="duplicating"
          aria-label="Duplicate document"
          title="Duplicate document"
          @click="duplicate"
        >
          <Icon name="copy" />
        </button>
        <button v-if="draft.doc.id && canWrite" type="button" class="mb-btn-ghost-danger" title="Delete document" @click="remove">
          <Icon name="trash" /> Delete
        </button>
      </EditorHeader>

      <DraftConflictNotices />

      <!-- `relative` so absolute children clip here, not in `main`. -->
      <div class="relative min-h-0 flex-1 overflow-auto">
        <EditorLayout class="mx-auto max-w-7xl p-4 sm:p-6 2xl:max-w-[100rem] 2xl:p-8">
            <ContentTitleSection :can-write="canWrite" :has-slug="contentType.hasSlug" />

            <div v-if="mainFields.length" class="mb-card">
              <FieldGrid
                :fields="mainFields"
                :values="draft.doc.fields"
                :path="[]"
                @update="setField"
              />
            </div>

          <template #aside>
            <ApprovalSection
              v-if="showApproval && draft.doc.id"
              :key="draft.doc.id"
              :space-id="draft.doc.spaceId"
              :content-id="draft.doc.id"
              :can-write="canWrite"
              :can-publish="canPublish"
              :is-published="isPublished"
              @published="onApproved"
            />

            <ContentPlacementSection
              :content-type="contentType"
              :can-write="canWrite"
              :used-in="usedIn"
              @assign-menus="assigningMenus = true"
            />

            <ContentTagsSection :can-write="canWrite" />

            <div v-if="sidebarFields.length" class="mb-card">
              <FieldGrid
                :fields="sidebarFields"
                :values="draft.doc.fields"
                :path="[]"
                @update="setField"
              />
            </div>

            <VersionHistory
              v-if="showHistory && draft.doc.id"
              :space-id="draft.doc.spaceId"
              :content-id="draft.doc.id"
              @restored="load"
            />
          </template>
        </EditorLayout>
      </div>
    </div>
    </PageState>

    <MenuAssignDialog
      v-if="assigningMenus && localizationId && draft.doc"
      :localization-id="localizationId"
      :title="draft.doc.title || 'This document'"
      @close="assigningMenus = false"
    />

    <VisualEditor
      v-if="showVisual && draft.doc && contentType"
      :document="draft.doc"
      :type="contentType"
      :draft="editorDraft"
      :close="() => (showVisual = false)"
    />

    <PluginSlot v-if="openView && draft.doc && contentType" id="content.editor.views" :props="{ document: draft.doc, type: contentType, draft: editorDraft, close: closeView }">
      <template #default="{ items }">
        <template v-for="view in items" :key="view.key">
          <component
            :is="view.component"
            v-if="view.key === openView"
            :document="draft.doc"
            :type="contentType"
            :draft="editorDraft"
            :close="closeView"
          />
        </template>
      </template>
    </PluginSlot>
  </div>
</template>
