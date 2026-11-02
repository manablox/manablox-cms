<script setup lang="ts">
import { Select, useSpaceStore } from '@manablox/admin-sdk';
import type { BlockBreakpoint, ContentTypeDefinition } from '@manablox/core';
import type { BlockDesign, BlockVariant, ThemeDesign } from '@manablox/site';
import { computed, ref, watch } from 'vue';
import type { AiAdminApi } from '../model/ai-api';
import { applyAiVariant, proposedVariants } from '../model/ai-block-design';
import { blockCanvasInput } from '../model/block-canvas';
import { compileDraftCss } from '../model/canvas';
import { sampleAssets, sampleFields } from '../model/sample-data';
import { canAddVariant } from '../model/variants';
import { type AiBlockDesignResult, themes } from '../queries';
import { useCanvasAssets } from '../useCanvasAssets';
import type { CanvasPayload } from '../useDesignCanvas';
import DesignCanvas from './DesignCanvas.vue';

/**
 * Proposes a design for a block type from a prompt and shows it on a canvas of its own with
 * sample content. Nothing is saved here: the chosen variant goes into the editor's draft.
 */
const props = defineProps<{
  /** The AI plugin's admin api. */
  ai: AiAdminApi;
  spaceId: string;
  typeId: string;
  /** The editor's draft. */
  design: BlockDesign;
  /** The variant on the editor's canvas. */
  variant: string;
  theme: ThemeDesign;
  siteUrl: string | null;
  locale: string;
}>();
const emit = defineEmits<{ close: []; apply: [design: BlockDesign, variant: string] }>();

const spaces = useSpaceStore();
const type = computed(() => spaces.typeById(props.typeId));

// Asked from the current design alone when the prompt is empty.
const run = props.ai.useDesignRun<AiBlockDesignResult>(
  (input) => themes.aiBlockDesign(props.spaceId, { typeId: props.typeId, ...input }),
  { ready: () => true },
);
const result = run.result;
const shown = ref('default');
const breakpoint = ref<BlockBreakpoint>('desktop');

const variants = computed(() => (result.value ? proposedVariants(result.value.design) : []));
watch(variants, (list) => {
  if (!list.some((entry) => entry.name === shown.value)) shown.value = list[0]?.name ?? 'default';
});
const proposed = computed<BlockVariant | null>(
  () => (result.value?.design.variants[shown.value] as BlockVariant | undefined) ?? null,
);
const currentLabel = computed(() => props.design.variants[props.variant]?.label || props.variant);

function apply(mode: 'add' | 'replace') {
  if (!proposed.value) return;
  const next = applyAiVariant(props.design, proposed.value, mode, props.variant);
  if (!next) return;
  emit('apply', next.design, next.name);
  emit('close');
}

const canvasAssets = useCanvasAssets(() => props.theme);
const payload = computed<CanvasPayload | null>(() => {
  const variant = proposed.value;
  const space = spaces.current;
  if (!variant || !space || !type.value) return null;
  const preview: BlockDesign = { variants: { [shown.value]: variant }, default: shown.value };
  const input = blockCanvasInput({
    typeId: props.typeId,
    design: preview,
    theme: props.theme,
    space: {
      id: space.id,
      name: space.name,
      defaultLocale: space.defaultLocale,
      locales: space.locales,
    },
    locale: props.locale,
    contentTypes: Object.fromEntries(spaces.contentTypes.map((entry) => [entry.id, entry])),
    fields: sampleFields(type.value.fields),
    assets: sampleAssets(),
  });
  const css = compileDraftCss(
    props.theme,
    [{ kind: 'block', key: props.typeId, data: preview }],
    canvasAssets.value,
  );
  return { input, css, focus: { kind: 'block', key: props.typeId, variant: shown.value } };
});
</script>

<template>
  <component
    :is="ai.DesignDialog"
    :title="`Design ${type?.label ?? 'this block'} with AI`"
    width="max-w-5xl"
    :space-id="spaceId"
    :run="run"
    label="How should the block look?"
    prompt-class="ws:min-h-20"
    placeholder="Image on the left, text on the right with a small uppercase label above the heading; stacked on phones."
    hint="Built from the block's fields and the theme's colors, fonts and spacing. It starts from the current design."
    @close="emit('close')"
  >
    <template #result>
      <template v-if="result && proposed">
        <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-3">
          <Select v-if="variants.length > 1" v-model="shown" :options="variants.map((entry) => ({ value: entry.name, label: entry.label }))" variant="sm" class="ws:!w-48" aria-label="Proposed variant" />
          <p v-if="result.notes" class="ws:min-w-0 ws:flex-1 ws:text-sm ws:text-surface-600 ws:dark:text-surface-400">{{ result.notes }}</p>
        </div>
        <div class="ws:h-96">
          <DesignCanvas v-model:breakpoint="breakpoint" :site-url="siteUrl" :payload="payload" read-only title="Proposed block design" />
        </div>
        <p v-if="result.unplaced.length" class="mb-callout ws:text-xs" role="status">
          Not shown: {{ result.unplaced.join(', ') }}. Place them from the checks after applying.
        </p>
        <ul v-if="result.problems.length" class="mb-meta ws:space-y-0.5">
          <li v-for="problem in result.problems" :key="problem">{{ problem }}</li>
        </ul>
      </template>
    </template>

    <template #primary>
      <template v-if="proposed">
        <button type="button" class="mb-btn-outline" :disabled="run.busy.value" :title="`Replaces the tree of ${currentLabel}; undo brings it back`" @click="apply('replace')">
          Replace "{{ currentLabel }}"
        </button>
        <button type="button" class="mb-btn-primary" :disabled="run.busy.value || !canAddVariant(design)" @click="apply('add')">
          Add as new variant
        </button>
      </template>
    </template>
  </component>
</template>
