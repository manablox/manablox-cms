<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import {
  BOARD_BREAKPOINT,
  gridValueOf,
  isBlockGrid,
  resolveBlockGrid,
} from '@manablox/admin-sdk/features/content/model/block-grid';
import { useBlockAddTakeover } from '@manablox/admin-sdk/features/content/useBlockAdder';
import { provideFieldContext } from '@manablox/admin-sdk/lib/field-context';
import { setAt } from '@manablox/admin-sdk/lib/paths';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { BlockValue } from '@manablox/core';
import type { FieldPath } from '@manablox/live-preview';
import { computed, nextTick, provide, ref, watch } from 'vue';
import VisualAddBlockSection from '~/features/content/components/VisualAddBlockSection.vue';
import VisualBlockSection from '~/features/content/components/VisualBlockSection.vue';
import VisualDocumentSection from '~/features/content/components/VisualDocumentSection.vue';
import VisualEditorHeader from '~/features/content/components/VisualEditorHeader.vue';
import { useBlockTypeChoice } from '~/features/content/useBlockTypeChoice';
import { useDraftBlocks } from '~/features/content/useDraftBlocks';
import { usePreviewDevice } from '~/features/content/usePreviewDevice';
import { usePreviewTargets } from '~/features/content/usePreviewTargets';
import { useVisualEditorBridge } from '~/features/content/useVisualEditorBridge';

/** Side-by-side editing against the live site over the `@manablox/live-preview` channel. */
const props = defineProps<AdminSlotProps['content.editor.views']>();

const spaces = useSpaceStore();

const iframe = ref<HTMLIFrameElement | null>(null);
const aside = ref<HTMLElement | null>(null);

const contentType = computed(() => spaces.typeById(props.document.typeId));
provideFieldContext(() => ({
  spaceId: spaces.currentId,
  locale: spaces.locale,
  errorFor: props.draft.errorFor,
  errorUnder: props.draft.errorUnder,
  readOnly: props.draft.readOnly,
  typeById: spaces.typeById,
  typeByName: spaces.typeByName,
  blockTypes: () => spaces.blockKinds,
  fieldTypeMeta: spaces.fieldTypeMeta,
  blockInspectors: true,
}));

/** Block fields are the editable canvas; the first one is the default. */
const blockFields = computed(() =>
  (contentType.value?.fields ?? []).filter((field) => {
    const meta = spaces.fieldTypeMeta(field.type);
    return meta?.nested === true;
  }),
);
const scalarFields = computed(() =>
  (contentType.value?.fields ?? [])
    .filter((field) => !spaces.fieldTypeMeta(field.type)?.nested)
    .sort((a, b) => a.admin.position - b.admin.position),
);
const activeField = ref<string | null>(null);
watch(
  blockFields,
  (fields) => {
    if (!activeField.value && fields[0]) activeField.value = fields[0].name;
  },
  { immediate: true },
);

const { device, deviceOptions, deviceLabel, canvas, frameWidth, scale, frameStyle, frameBoxStyle } =
  usePreviewDevice();
// Nested blocks-field boards follow the same device.
provide(BOARD_BREAKPOINT, device);

// Selection and block edits.

/** A block, a block field, or a document field. */
const selectedPath = ref<FieldPath | null>(null);
const blocks = useDraftBlocks({
  doc: () => props.document,
  contentType: () => contentType.value,
  typeById: spaces.typeById,
  fieldTypeMeta: spaces.fieldTypeMeta,
  blockKinds: () => spaces.blockKinds,
  selection: selectedPath,
});
const {
  selectedBlockPath,
  selectedBlock,
  selectedList,
  selectedIndex,
  selectedSiblings,
  selectedListDefinition,
  selectedGrid,
  selectedTypeLabel,
} = blocks;

function select(path: FieldPath | null) {
  selectedPath.value = path;
  choice.cancel();
  void focusSelected();
}

/** Focuses the panel input matching the selection. */
async function focusSelected() {
  await nextTick();
  const name = blocks.selectedFieldName.value ?? blocks.selectedTopField.value;
  const definition = name ? blocks.definitionFor(name) : null;
  const target = definition
    ? aside.value?.querySelector<HTMLElement>(`#field-${CSS.escape(definition.id)}`)
    : name === 'title'
      ? aside.value?.querySelector<HTMLElement>('#visual-title')
      : null;
  if (!target) return;
  target.scrollIntoView({ block: 'nearest' });
  target.focus({ preventScroll: true });
}

function selectFromBoard(list: FieldPath, blockId: string) {
  const index = blocks.listAt(list).findIndex((block) => block.blockId === blockId);
  if (index >= 0) select([...list, index]);
}

const choice = useBlockTypeChoice({
  panel: aside,
  allowedTypes: blocks.allowedTypes,
  insert: blocks.insert,
  select,
});

// Plugin entries may frame their own page; until each has answered, nothing is framed.
const { targetProps, targetPropsOf, decided, target } = usePreviewTargets(() => ({
  document: props.document,
  type: props.type,
  readOnly: props.draft.readOnly,
}));

const { connected, previewSrc } = useVisualEditorBridge({
  iframe,
  siteUrl: () => (decided.value ? spaces.current?.url : null),
  target: () => (decided.value ? target.value : null),
  doc: () => props.document,
  revision: () => props.draft.revision,
  contentType: () => contentType.value,
  typeById: spaces.typeById,
  fieldTypeMeta: spaces.fieldTypeMeta,
  highlighted: () => selectedBlockPath.value,
  readOnly: () => props.draft.readOnly,
  on: {
    onMoveBlock: blocks.move,
    onRemoveBlock: blocks.remove,
    onAddBlock: choice.request,
    onLayoutBlock: blocks.layout,
    onEditField: blocks.edit,
    onSelectField: select,
    // The page owns saving.
    onRequestSave: () => void props.draft.save(),
  },
});

function updateSelectedFields(fields: Record<string, unknown>) {
  if (!selectedBlockPath.value) return;
  props.document.fields = setAt(
    props.document.fields,
    [...selectedBlockPath.value, 'fields'],
    fields,
  );
}

function replaceSelected(block: BlockValue) {
  if (!selectedBlockPath.value) return;
  props.document.fields = setAt(props.document.fields, selectedBlockPath.value, block);
}

function updateTopField(name: string, value: unknown) {
  props.document.fields = { ...props.document.fields, [name]: value };
}

// The active block field, shown when nothing is selected.

const activeFieldDefinition = computed(
  () => blockFields.value.find((field) => field.name === activeField.value) ?? null,
);
const activeBlocks = computed(() =>
  activeFieldDefinition.value ? blocks.listAt([activeFieldDefinition.value.name]) : [],
);
const activeGrid = computed(() => {
  if (!activeFieldDefinition.value) return null;
  const grid = resolveBlockGrid(
    gridValueOf(props.document.fields[activeFieldDefinition.value.name]),
  );
  return isBlockGrid(grid) ? grid : null;
});
// Alt+N adds after the selection or at the end; taken from the page's blocks fields behind this overlay.
useBlockAddTakeover({
  can: () => !props.draft.readOnly && Boolean(selectedList.value || activeFieldDefinition.value),
  add: () => {
    if (selectedList.value) choice.request(selectedList.value, selectedIndex.value + 1);
    else if (activeFieldDefinition.value) {
      choice.request([activeFieldDefinition.value.name], activeBlocks.value.length);
    }
  },
});
</script>

<template>
  <!-- Teleported to escape ancestor stacking contexts. -->
  <Teleport to="body">
    <div class="mb-z-overlay fixed inset-0 flex flex-col bg-surface-100 dark:bg-surface-950">
      <VisualEditorHeader
        v-model:device="device"
        v-model:active-field="activeField"
        :title="document.title"
        :connected="connected"
        :status="target?.status"
        :device-options="deviceOptions"
        :frame-width="frameWidth"
        :scale="scale"
        :block-fields="blockFields"
        :draft="draft"
        :close="close"
        :target-props="targetProps"
        :target-props-of="targetPropsOf"
      />

      <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div class="min-h-[40vh] min-w-0 flex-1 bg-surface-200/70 p-4 dark:bg-surface-900">
          <div ref="canvas" class="flex h-full w-full justify-center">
          <div
            class="relative shrink-0 overflow-hidden rounded-card border border-surface-300 bg-white shadow-pop transition-[width] duration-[var(--mb-dur-slow)] dark:border-surface-700"
            :style="frameBoxStyle"
          >
            <iframe
              v-if="previewSrc"
              ref="iframe"
              :src="previewSrc"
              class="absolute top-0 left-0 border-0 bg-white"
              :style="frameStyle"
              sandbox="allow-scripts allow-same-origin allow-forms"
              title="Content preview"
            />
            <div v-else-if="decided" class="flex h-full items-center justify-center p-6 text-center text-sm text-surface-500">
              {{ target ? (target.empty ?? 'Nothing to show here.') : 'This space has no frontend URL configured.' }}
            </div>
          </div>
          </div>
        </div>

        <aside
          ref="aside"
          class="max-h-[50vh] w-full shrink-0 overflow-auto border-t border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900 lg:max-h-none lg:w-[27rem] lg:border-t-0 lg:border-l"
        >
          <!-- Block type choice. -->
          <VisualAddBlockSection
            v-if="choice.adding.value"
            :types="blocks.allowedTypes(choice.adding.value.list)"
            @pick="choice.add(choice.adding.value.list, choice.adding.value.index, $event)"
            @cancel="choice.cancel()"
          />

          <!-- Selected block. -->
          <VisualBlockSection
            v-else-if="selectedBlock && selectedBlockPath && selectedList"
            v-model:device="device"
            :block="selectedBlock"
            :path="selectedBlockPath"
            :list-label="selectedListDefinition?.label ?? selectedList.join('.')"
            :index="selectedIndex"
            :siblings="selectedSiblings"
            :grid="selectedGrid"
            :type-label="selectedTypeLabel"
            :device-label="deviceLabel"
            :read-only="draft.readOnly"
            :label-of="blocks.labelOf"
            @back="select(null)"
            @move="blocks.move(selectedList, selectedIndex, $event)"
            @add-after="choice.request(selectedList, selectedIndex + 1)"
            @remove="blocks.remove(selectedList, selectedIndex)"
            @layout="(id, layout) => blocks.setLayoutById(selectedList ?? [], id, layout)"
            @select="selectFromBoard(selectedList ?? [], $event)"
            @update:fields="updateSelectedFields"
            @replace="replaceSelected"
          />

          <!-- Nothing selected: document fields and the active block field. -->
          <VisualDocumentSection
            v-else
            :document="document"
            :scalar-fields="scalarFields"
            :field="activeFieldDefinition"
            :block-count="activeBlocks.length"
            :has-grid="Boolean(activeGrid)"
            :device-label="deviceLabel"
            :read-only="draft.readOnly"
            @update="updateTopField"
          />
        </aside>
      </div>
    </div>
  </Teleport>
</template>
