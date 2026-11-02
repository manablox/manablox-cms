<script setup lang="ts">
import {
  Dialog,
  provideFieldContext,
  runWrite,
  SaveButton,
  shortcutHint,
  TextareaField,
  useSpaceStore,
} from '@manablox/admin-sdk';
import type { BlocksValue, BlockValue } from '@manablox/core';
import { computed, ref } from 'vue';
import type { AiProviderRef } from '../../sdk';
import {
  type GeneratedDocument,
  type GeneratedImage,
  type RepeaterItem,
  toBlocksValue,
  toItemsValue,
} from '../model/document';
import { ai } from '../queries';
import { useDocumentImages } from '../useDocumentImages';
import { generationFailure, useGenerationFollow } from '../useGenerationFollow';
import { useGenerationOptions } from '../useGenerationOptions';
import AiSparkles from './AiSparkles.vue';
import DocumentResult from './DocumentResult.vue';
import GenerationControls from './GenerationControls.vue';

/** AI generation dialog for text, image, video or a whole document. Nothing is applied until Use. */
const props = defineProps<{
  spaceId: string;
  /** `document` fills every text field of `contentTypeId` at once. */
  capability: 'text' | 'image' | 'video' | 'document';
  /** Passed to the model as context. */
  context?: Record<string, unknown> | undefined;
  /** Required for `document`. */
  contentTypeId?: string | undefined;
  locale?: string | undefined;
  title?: string | undefined;
  /** Provider kinds, or `custom:<slug>`. */
  providerKinds: AiProviderRef[];
}>();

const emit = defineEmits<{
  close: [];
  text: [value: string];
  asset: [assetId: string];
  fields: [document: GeneratedDocument];
}>();

const spaces = useSpaceStore();

const options = useGenerationOptions({
  spaceId: () => props.spaceId,
  capability: () => props.capability,
  contentTypeId: () => props.contentTypeId,
  initialKind: props.providerKinds[0] ?? '',
});

const prompt = ref('');
const busy = ref(false);
const note = ref<string | null>(null);

const answer = ref<string | null>(null);
const assetId = ref<string | null>(null);
const assetUrl = ref<string | null>(null);
const fields = ref<Record<string, string> | null>(null);
/** Generated blocks per field, edited in place by the preview's real block field. */
const blocks = ref<Record<string, BlocksValue>>({});
/** Generated repeater items per field, edited in place like the blocks. */
const items = ref<Record<string, RepeaterItem[]>>({});
const images = ref<GeneratedImage[]>([]);

// Own field context for the block preview; nothing here is saved.
provideFieldContext(() => ({
  spaceId: props.spaceId,
  locale: props.locale ?? spaces.locale,
  errorFor: () => null,
  errorUnder: () => false,
  readOnly: false,
  typeById: spaces.typeById,
  typeByName: spaces.typeByName,
  blockTypes: () => spaces.blockKinds,
  fieldTypeMeta: spaces.fieldTypeMeta,
}));

const { follow } = useGenerationFollow(() => props.spaceId);
const { imageProvider, drawing, pending, canDraw, draw } = useDocumentImages({
  spaceId: () => props.spaceId,
  images,
  blocks,
  typeById: spaces.typeById,
  note,
  blocked: () => busy.value,
});

const canGenerate = computed(() => Boolean(prompt.value.trim()) && !busy.value);
const hasResult = computed(() => Boolean(answer.value || assetId.value || fields.value));

async function generate() {
  if (!canGenerate.value) return;
  answer.value = null;
  assetId.value = null;
  assetUrl.value = null;
  fields.value = null;
  blocks.value = {};
  items.value = {};
  images.value = [];

  const base = {
    spaceId: props.spaceId,
    prompt: prompt.value.trim(),
    ...options.requestOptions(),
    ...(props.context ? { context: props.context as never } : {}),
  };

  await runWrite(
    async () => {
      if (props.capability === 'text') {
        const result = await ai.text(base);
        answer.value = result.text;
      } else if (props.capability === 'document') {
        const result = await ai.document({
          ...base,
          contentTypeId: props.contentTypeId as string,
          locale: props.locale ?? null,
          ...options.documentOptions(),
        });
        await showDocument(result);
      } else {
        const generation = await ai.media({ ...base, capability: props.capability });
        note.value =
          props.capability === 'video' ? 'Rendering. A video takes a few minutes.' : 'Generating.';
        const row = await follow(generation.id);
        if (row?.status === 'failed') note.value = generationFailure(row);
        else if (row?.assetId) {
          assetId.value = row.assetId;
          assetUrl.value = (await ai.asset(props.spaceId, row.assetId))?.url ?? null;
          note.value = null;
        }
      }
    },
    { busy, error: note },
  );
}

/** A generated document into the result: rich text parsed, pictures not drawn yet. */
async function showDocument(result: Awaited<ReturnType<typeof ai.document>>) {
  fields.value = result.fields;
  const grids = (result.grids ?? {}) as Record<string, BlocksValue['grid']>;
  blocks.value = Object.fromEntries(
    await Promise.all(
      Object.entries((result.blocks ?? {}) as Record<string, BlockValue[]>).map(
        async ([name, written]) =>
          [name, await toBlocksValue(written, grids[name], spaces.typeById)] as const,
      ),
    ),
  );
  const fieldByName = (name: string) =>
    options.documentType?.fields.find((field) => field.name === name);
  items.value = Object.fromEntries(
    await Promise.all(
      Object.entries(result.items ?? {}).map(
        async ([name, written]) => [name, await toItemsValue(written, fieldByName(name))] as const,
      ),
    ),
  );
  images.value = (result.images ?? []).map((image) => ({
    ...image,
    assetId: null,
    url: null,
  }));
}

function use() {
  if (fields.value) {
    emit('fields', {
      fields: fields.value,
      blocks: blocks.value,
      items: items.value,
      // Block pictures are already placed.
      images: images.value.filter((image) => image.assetId && !image.blockId),
    });
  } else if (assetId.value) emit('asset', assetId.value);
  else if (answer.value) emit('text', answer.value);
  emit('close');
}

const heading = computed(() => props.title ?? HEADINGS[props.capability] ?? 'Generate with AI');
const HEADINGS: Record<string, string> = {
  text: 'Write with AI',
  image: 'Generate an image',
  video: 'Generate a video',
  document: 'Generate the whole document',
};

const PLACEHOLDERS: Record<string, string> = {
  text: 'What should this say? Name the point to make, not the words to use.',
  image: 'What should be in the picture?',
  video: 'What happens in the shot?',
  document: 'What is this document about? Anything the model cannot guess belongs here.',
};
</script>

<template>
  <Dialog :title="heading" :width="capability === 'document' ? 'max-w-5xl' : 'max-w-2xl'" @close="emit('close')">
    <div class="ai:space-y-4">
      <GenerationControls :space-id="spaceId" :capability="capability" :provider-kinds="providerKinds" :options="options" />

      <TextareaField
        v-model="prompt"
        label="Prompt"
        class="ai:min-h-28"
        :placeholder="PLACEHOLDERS[capability]"
        maxlength="4000"
        autofocus
        :hint="`${shortcutHint('mod+enter')} generates. The space's system prompt is applied on top.`"
        @keydown.meta.enter="generate"
        @keydown.ctrl.enter="generate"
      />

      <p v-if="note" class="mb-callout" role="status">{{ note }}</p>

      <TextareaField
        v-if="answer !== null"
        v-model="answer"
        label="Result"
        class="mb-input-mono ai:min-h-40"
        hint="Edit it here if it is nearly right."
      />

      <div v-if="assetUrl" class="ai:space-y-1">
        <p class="mb-label">Result</p>
        <video v-if="capability === 'video'" :src="assetUrl" class="ai:w-full ai:rounded-card" controls />
        <img v-else :src="assetUrl" alt="" class="ai:w-full ai:rounded-card" />
        <p class="mb-hint">It is already in the asset library, whether or not you use it here.</p>
      </div>

      <DocumentResult
        v-if="capability === 'document'"
        v-model:blocks="blocks"
        v-model:items="items"
        :fields="fields"
        :document-type="options.documentType"
        :images="images"
        :drawing="drawing"
        :has-image-provider="Boolean(imageProvider)"
      />
    </div>

    <template #footer="{ close }">
      <button type="button" class="mb-btn-ghost" @click="close">Cancel</button>
      <SaveButton :saving="busy" icon="wand" variant="outline" class="ai:relative" :disabled="!canGenerate" @click="generate">
        <AiSparkles :active="busy" />
        {{ hasResult ? 'Again' : 'Generate' }}
      </SaveButton>
      <SaveButton v-if="pending.length" :saving="drawing" icon="image" variant="outline" class="ai:relative" :disabled="!canDraw" @click="draw">
        <AiSparkles :active="drawing" />
        {{ pending.length === images.length ? `Draw ${images.length} pictures` : `Draw the remaining ${pending.length}` }}
      </SaveButton>
      <button type="button" class="mb-btn-primary" :disabled="!hasResult || busy" @click="use">Use it</button>
    </template>
  </Dialog>
</template>
