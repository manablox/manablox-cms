import { type ContentTypeSummary, runWrite } from '@manablox/admin-sdk';
import type { BlocksValue } from '@manablox/core';
import { computed, type Ref, ref } from 'vue';
import { assetValue, type GeneratedImage, withBlockField } from './model/document';
import { ai, useAiProviders } from './queries';
import { generationFailure, useGenerationFollow } from './useGenerationFollow';

export interface DocumentImagesOptions {
  spaceId: () => string;
  /** The picture briefs of a generated document. */
  images: Ref<GeneratedImage[]>;
  /** Generated block fields; drawn block pictures are placed here. */
  blocks: Ref<Record<string, BlocksValue>>;
  typeById: (id: string) => ContentTypeSummary | null;
  /** Progress and failure line. */
  note: Ref<string | null>;
  /** Blocks drawing while another job runs. */
  blocked: () => boolean;
}

/** Draws a generated document's pictures with the space's image provider. */
export function useDocumentImages(options: DocumentImagesOptions) {
  const { images, blocks, note } = options;
  const providers = useAiProviders(options.spaceId);
  const { follow } = useGenerationFollow(options.spaceId);

  /** The space's image provider, if any. */
  const imageProvider = computed(() =>
    providers.data.value?.find(
      (row) => row.enabled && row.hasKey && row.capabilities.includes('image'),
    ),
  );

  const drawing = ref(false);
  const pending = computed(() => images.value.filter((image) => !image.assetId));
  const canDraw = computed(
    () =>
      Boolean(imageProvider.value) &&
      pending.value.length > 0 &&
      !drawing.value &&
      !options.blocked(),
  );

  /** Puts a drawn picture into its block; document-level pictures are placed on apply. */
  function place(image: GeneratedImage) {
    const value = blocks.value[image.field];
    if (!image.assetId || !image.blockId || !image.blockField || !value) return;
    const block = value.blocks.find((entry) => entry.blockId === image.blockId);
    const settings = options
      .typeById(block?.type ?? '')
      ?.fields.find((entry) => entry.name === image.blockField)?.settings;
    if (!settings) return;
    blocks.value[image.field] = withBlockField(
      value,
      image.blockId,
      image.blockField,
      assetValue(settings, image.assetId),
    );
  }

  /** Draws pending pictures one by one: providers rate-limit, and a failure keeps earlier ones. */
  async function draw(): Promise<void> {
    const provider = imageProvider.value;
    if (!provider) return;
    await runWrite(
      async () => {
        for (const [index, image] of images.value.entries()) {
          if (image.assetId) continue;
          note.value = `Drawing ${index + 1} of ${images.value.length}: ${image.label}...`;
          const generation = await ai.media({
            spaceId: options.spaceId(),
            capability: 'image',
            prompt: image.prompt,
            providerKind: provider.kind,
            // Space defaults plus the requested aspect ratio.
            styles: {
              ...provider.defaults,
              ...(image.aspectRatio ? { aspectRatio: image.aspectRatio } : {}),
            },
          });
          const row = await follow(generation.id);
          if (!row) return;
          if (row.status === 'failed') {
            note.value = generationFailure(row);
            return;
          }
          if (row.assetId) {
            image.assetId = row.assetId;
            image.url = (await ai.asset(options.spaceId(), row.assetId))?.url ?? null;
            place(image);
          }
        }
        note.value = null;
      },
      { busy: drawing, error: note },
    );
  }

  return { imageProvider, drawing, pending, canDraw, draw };
}
