import { useSpaceStore } from '@manablox/admin-sdk';
import { computed, ref, watch } from 'vue';

/**
 * The generate dialog's document-only controls: the block types the model may use (every one
 * the document's block fields accept, at first), pictures, audience and keywords.
 */
export function useDocumentOptions(contentTypeId: () => string | undefined) {
  const spaces = useSpaceStore();

  const allowedBlocks = ref<string[]>([]);
  const includeImages = ref(true);
  const audience = ref('');
  const keywords = ref('');

  const documentType = computed(() => {
    const id = contentTypeId();
    return id ? spaces.typeById(id) : null;
  });

  /** Block types the document's block fields accept; an unrestricted field offers all. */
  const blockChoices = computed(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const field of documentType.value?.fields ?? []) {
      if (field.type !== 'blocks' && field.type !== 'block') continue;
      const settings = field.settings as { type?: string; types?: string[] };
      const ids = field.type === 'block' ? [settings.type] : (settings.types ?? []);
      const types = ids.length
        ? ids.map((id) => (id ? spaces.typeById(id) : null))
        : spaces.blockKinds;
      for (const type of types) if (type) seen.set(type.id, { id: type.id, label: type.label });
    }
    return [...seen.values()];
  });
  watch(
    blockChoices,
    (choices) => {
      allowedBlocks.value = choices.map((choice) => choice.id);
    },
    { immediate: true },
  );

  function toggleBlock(id: string, on: boolean) {
    allowedBlocks.value = on
      ? [...allowedBlocks.value, id]
      : allowedBlocks.value.filter((entry) => entry !== id);
  }

  /** The document request's extra controls. */
  function documentOptions() {
    const everyBlock = allowedBlocks.value.length === blockChoices.value.length;
    const terms = keywords.value
      .split(',')
      .map((term) => term.trim())
      .filter(Boolean);
    return {
      ...(everyBlock || !allowedBlocks.value.length ? {} : { blockTypes: allowedBlocks.value }),
      images: includeImages.value,
      ...(audience.value.trim() ? { audience: audience.value.trim() } : {}),
      ...(terms.length ? { keywords: terms } : {}),
    };
  }

  return {
    documentType,
    blockChoices,
    allowedBlocks,
    toggleBlock,
    includeImages,
    audience,
    keywords,
    documentOptions,
  };
}
