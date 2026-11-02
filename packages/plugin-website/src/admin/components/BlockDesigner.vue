<script setup lang="ts">
import { confirm, EmptyState, useSpaceStore } from '@manablox/admin-sdk';
import type { BlockBreakpoint, ContentTypeDefinition } from '@manablox/core';
import {
  type BlockDesign,
  type BlockVariant,
  findBrokenBindings,
  findUnplacedFields,
  generateBlockDesign,
  type SiteCssDesign,
  type ThemeDesign,
  validateSiteDesign,
} from '@manablox/site';
import { computed, ref, watch } from 'vue';
import { bindingOptions, repeatScope, withRelated } from '../model/bindings';
import { blockCanvasInput } from '../model/block-canvas';
import { compileDraftCss } from '../model/canvas';
import { nodeAtPath } from '../model/outline';
import {
  assetIdsIn,
  mediaAssets,
  type SampleChoice,
  sampleAssets,
  sampleFields,
} from '../model/sample-data';
import { designIds, withVariantRoot } from '../model/variants';
import { useSiteDesign } from '../queries';
import { useCanvasAssets } from '../useCanvasAssets';
import type { CanvasPayload } from '../useDesignCanvas';
import { useDesignDraft } from '../useDesignDraft';
import { useDesigner } from '../useDesigner';
import { useSiteContext } from '../useSiteContext';
import AiBlockDesignButton from './AiBlockDesignButton.vue';
import BlockVariantsSection from './BlockVariantsSection.vue';
import DesignerShell from './DesignerShell.vue';
import DesignWarnings from './DesignWarnings.vue';
import PaneSection from './PaneSection.vue';
import SampleDataPicker from './SampleDataPicker.vue';

/**
 * The block designer: the element tree of one block type's design, per variant. Mounted per
 * type, so a switch saves the old draft under its own key.
 */
const props = defineProps<{ typeId: string }>();
const spaces = useSpaceStore();
const { canWrite, canvasOrigin } = useSiteContext();
const readOnly = computed(() => !canWrite.value);

const typeId = computed(() => props.typeId);
const type = computed(() => {
  const found = spaces.typeById(typeId.value);
  return found?.kind === 'block' ? found : null;
});
const fields = computed(() => withRelated(type.value?.fields ?? [], spaces.typeById));

const block = useDesignDraft('block', typeId, {
  readOnly,
  fallback: () => (type.value ? generateBlockDesign(type.value) : null),
});
const { draft } = block;
const themeQuery = useSiteDesign('theme', 'default');
const theme = computed(() => (themeQuery.data.value?.data as ThemeDesign | undefined) ?? null);

// Variant on the canvas.
const variant = ref('default');
watch(
  draft,
  (current) => {
    if (current && !current.variants[variant.value]) variant.value = current.default;
  },
  { immediate: true },
);
const root = computed(() => draft.value?.variants[variant.value]?.root ?? null);

function updateDesign(next: BlockDesign, group?: string) {
  block.update(next, group);
}

const breakpoint = ref<BlockBreakpoint>('desktop');
const exactSizes = ref(false);
const locale = ref(spaces.locale);
const locales = computed(() => spaces.current?.locales ?? [locale.value]);

const designer = useDesigner({
  designKind: 'block',
  designKey: () => typeId.value,
  root: () => root.value,
  setRoot: (next, group) => {
    if (draft.value) updateDesign(withVariantRoot(draft.value, variant.value, next), group);
  },
  fields: () => fields.value,
  locale: () => locale.value,
  locales: () => locales.value,
  theme: () => theme.value,
  breakpoint: () => breakpoint.value,
  advanced: () => exactSizes.value,
  readOnly: () => readOnly.value,
  takenIds: () => (draft.value ? designIds(draft.value) : new Set()),
});
const { selected } = designer;

// Palette: data elements need a field that fits where they would go.
const unavailable = computed(() => {
  const tree = root.value;
  if (!tree) return {};
  const parentId = selected.value?.parent?.id ?? tree.id;
  const scope = repeatScope(tree, parentId);
  const out: Record<string, string> = { ...designer.formUnavailable.value };
  for (const kind of ['repeat', 'blocks', 'block', 'template'] as const) {
    if (bindingOptions(fields.value, kind, scope).length === 0)
      out[kind] = `No field of this block type fits a ${kind} element here.`;
  }
  return out;
});

// Sample content.
const sample = ref<SampleChoice | null>(null);
const holderTypeIds = computed(() =>
  spaces.contentKinds
    .filter((entry) =>
      entry.fields.some(
        (field) =>
          field.type === 'blocks' ||
          field.type === 'block' ||
          (field.type === 'repeater' && JSON.stringify(field.settings).includes('"blocks"')),
      ),
    )
    .map((entry) => entry.id),
);
const contentTypes = computed(() =>
  Object.fromEntries(spaces.contentTypes.map((entry) => [entry.id, entry])),
);

const canvasAssets = useCanvasAssets(() => theme.value);
const payload = computed<CanvasPayload | null>(() => {
  const current = draft.value;
  const space = spaces.current;
  if (!current || !space || !theme.value || !type.value) return null;
  const origin = window.location.origin;
  const values =
    sample.value?.block.fields ?? sampleFields(fields.value, spaces.dataKinds[0]?.id ?? null);
  const assets = sample.value
    ? mediaAssets(assetIdsIn(fields.value, values), origin)
    : sampleAssets();
  const input = blockCanvasInput({
    typeId: typeId.value,
    design: current,
    theme: theme.value,
    space: {
      id: space.id,
      name: space.name,
      defaultLocale: space.defaultLocale,
      locales: space.locales,
    },
    locale: locale.value,
    contentTypes: contentTypes.value,
    fields: values,
    assets,
  });
  // Nested blocks render with their generated designs, so their rules come along.
  const designs: SiteCssDesign[] = [{ kind: 'block', key: typeId.value, data: current }];
  if (sample.value)
    for (const other of spaces.blockKinds)
      if (other.id !== typeId.value)
        designs.push({ kind: 'block', key: other.id, data: generateBlockDesign(other) });
  const css = compileDraftCss(theme.value, designs, canvasAssets.value);
  return { input, css, focus: { kind: 'block', key: typeId.value, variant: variant.value } };
});

// Checks.
const variantDesign = computed<BlockDesign | null>(() => {
  const current = draft.value?.variants[variant.value];
  return current
    ? { variants: { [variant.value]: current as BlockVariant }, default: variant.value }
    : null;
});
const unplaced = computed(() =>
  variantDesign.value && type.value ? findUnplacedFields(variantDesign.value, type.value) : [],
);
const broken = computed(() =>
  variantDesign.value && type.value ? findBrokenBindings(variantDesign.value, type.value) : [],
);
const issues = computed(() => {
  if (!draft.value) return [];
  const result = validateSiteDesign('block', draft.value);
  return result.ok ? [] : result.issues;
});

function selectIssue(path: string) {
  const match = /^variants\.([^.]+)\.(root(?:\..*)?)$/.exec(path);
  if (!match || !draft.value) return;
  const name = match[1] as string;
  const tree = draft.value.variants[name]?.root;
  if (!tree) return;
  variant.value = name;
  designer.select(nodeAtPath(tree, match[2] as string));
}

const checkCount = computed(
  () => unplaced.value.length + broken.value.length + issues.value.length,
);

async function resetToGenerated() {
  if (!type.value) return;
  const ok = await confirm({
    title: 'Start over from the fields?',
    message:
      'Every variant is replaced with the design generated from the block type. Undo brings it back; nothing goes live until you publish.',
    confirmLabel: 'Start over',
  });
  if (!ok) return;
  updateDesign(generateBlockDesign(type.value));
  variant.value = 'default';
}
</script>

<template>
  <DesignerShell
    v-model:breakpoint="breakpoint"
    v-model:locale="locale"
    v-model:exact="exactSizes"
    :designer="designer"
    :draft="block"
    :theme-query="themeQuery"
    loading-label="Loading the block design..."
    :missing="!type"
    :title="type?.label ?? ''"
    kind="Block design"
    icon="blocks"
    :back="{ to: '/design/blocks', label: 'Blocks' }"
    :what="`the design of &quot;${type?.label}&quot;`"
    reset-label="Start over from the fields"
    :unavailable="unavailable"
    tips-id="elements"
    :tips="[
      { icon: 'mouse-pointer-2', text: 'Click the preview to select, change it on the right' },
      { icon: 'plus', text: 'Drag new elements in from Add' },
      { icon: 'upload', text: 'Drafts save by themselves; Publish makes them live' },
    ]"
    :payload="payload"
    :canvas-title="`Design of ${type?.label}`"
    @reset="resetToGenerated"
  >
    <template #missing>
      <EmptyState icon="blocks" title="No such block type" description="It may have been deleted, or it is a content type rather than a block type.">
        <RouterLink to="/design/blocks" class="mb-btn-outline">All block designs</RouterLink>
      </EmptyState>
    </template>

    <template #actions>
      <AiBlockDesignButton
        v-if="!readOnly && draft && theme && spaces.currentId"
        :space-id="spaces.currentId"
        :type-id="typeId"
        :design="draft"
        :variant="variant"
        :theme="theme"
        :site-url="canvasOrigin"
        :locale="locale"
        @apply="(next, name) => { updateDesign(next); variant = name; }"
      />
    </template>

    <template #elements-top>
      <PaneSection v-if="draft && type" id="block-variants" title="Variants" icon="copy" :summary="`${Object.keys(draft.variants).length}`" :default-open="false">
        <BlockVariantsSection v-model="variant" :design="draft" :type="type" :read-only="readOnly" @update="updateDesign" />
      </PaneSection>
    </template>

    <template #canvas-note>
      <template v-if="sample">Content from "{{ sample.title }}"</template>
    </template>

    <template #panes>
      <PaneSection id="sample" title="Preview content" icon="eye" :summary="sample ? 'from a page' : 'sample text'">
        <p class="mb-meta">What the preview fills the fields with. Nothing here is saved.</p>
        <SampleDataPicker v-model="sample" :block-type-id="typeId" :type-ids="holderTypeIds" :locale="locale" />
      </PaneSection>
      <PaneSection id="checks" title="Checks" icon="list-checks" :summary="checkCount ? `${checkCount} to look at` : 'all good'" :summary-tone="checkCount ? 'warn' : 'ok'">
        <DesignWarnings
          :unplaced="unplaced"
          :broken="broken"
          :issues="issues"
          :read-only="readOnly"
          @place-field="designer.insertField"
          @select-node="designer.select"
          @select-issue="selectIssue"
        />
      </PaneSection>
    </template>
  </DesignerShell>
</template>
