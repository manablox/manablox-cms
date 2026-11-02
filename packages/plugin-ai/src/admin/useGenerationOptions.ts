import { computed, reactive, ref, watch } from 'vue';
import type { AiProviderRef } from '../sdk';
import { useAiCatalog, useAiProviders, useAiSettings } from './queries';
import { useDocumentOptions } from './useDocumentOptions';
import { useModelChoice } from './useModelChoice';

interface GenerationOptionsInput {
  spaceId: () => string;
  capability: () => 'text' | 'image' | 'video' | 'document';
  /** The document's content type, for the document controls. */
  contentTypeId: () => string | undefined;
  /** The provider picked first. */
  initialKind: AiProviderRef | '';
}

interface StyleGroupOptions {
  id: string;
  optional: boolean;
  options: readonly { id: string; label: string }[];
}

/** Select options for a style group; optional groups offer "No preference". */
export function optionsFor(group: StyleGroupOptions) {
  const options = group.options.map((option) => ({ value: option.id, label: option.label }));
  return group.optional ? [{ value: '', label: 'No preference' }, ...options] : options;
}

/**
 * The generate dialog's controls: provider and model, style groups with the provider's saved
 * defaults, length (a preset or exact numbers) and the document-only controls. Reactive, so
 * `GenerationControls` binds its fields directly.
 */
export function useGenerationOptions(input: GenerationOptionsInput) {
  const catalogQuery = useAiCatalog();
  const providersQuery = useAiProviders(input.spaceId);
  const settingsQuery = useAiSettings(input.spaceId);

  /** `document` uses the text style pickers. */
  const styleCapability = computed(() => {
    const capability = input.capability();
    return capability === 'document' ? 'text' : capability;
  });
  const groups = computed(() =>
    (catalogQuery.data.value?.styleGroups ?? []).filter((group) =>
      group.capabilities.includes(styleCapability.value),
    ),
  );
  /** Length has its own control. */
  const pickerGroups = computed(() => groups.value.filter((group) => group.id !== 'length'));
  const sizesText = computed(() => groups.value.some((group) => group.id === 'length'));

  const { kind, isCustom, cardModel, modelOptions, model } = useModelChoice({
    catalog: catalogQuery,
    providers: providersQuery,
    capability: styleCapability,
    initialKind: input.initialKind,
  });

  const styles = ref<Record<string, string>>({});

  /** Length lives in `styles.length`: a preset id, or `custom` for exact numbers. */
  const presets = computed(
    () => settingsQuery.data.value?.lengths ?? catalogQuery.data.value?.lengths ?? [],
  );
  const lengthOptions = computed(() => [
    { value: '', label: 'No preference' },
    ...presets.value.map((preset) => ({
      value: preset.id,
      label: preset.label,
      hint:
        input.capability() === 'document'
          ? `about ${preset.documentWords} words${preset.blocks ? `, ${preset.blocks} blocks` : ''}`
          : `about ${preset.fieldWords} words`,
    })),
    { value: 'custom', label: 'Custom...', hint: 'Say exactly how long' },
  ]);
  const customWords = ref<number | null>(null);
  const customBlocks = ref<number | null>(null);

  function lengthInput(): { words?: number; blocks?: number } | undefined {
    if (styles.value.length !== 'custom') return undefined;
    const out: { words?: number; blocks?: number } = {};
    if (customWords.value && customWords.value > 0) out.words = Math.round(customWords.value);
    if (input.capability() === 'document' && customBlocks.value && customBlocks.value > 0) {
      out.blocks = Math.round(customBlocks.value);
    }
    return Object.keys(out).length ? out : undefined;
  }

  const documentControls = useDocumentOptions(input.contentTypeId);

  /** Groups set by hand; defaults never overwrite them. */
  const touched = new Set<string>();

  /** Apply the provider's saved defaults once the data arrives and on provider switch. */
  watch(
    [() => providersQuery.data.value, groups, kind],
    ([rows, shown, chosen]) => {
      const saved = rows?.find((row) => row.kind === chosen)?.defaults ?? {};
      for (const group of shown) {
        if (touched.has(group.id)) continue;
        // Required groups fall back to their first option.
        styles.value[group.id] =
          saved[group.id] ?? (group.optional ? '' : (group.options[0]?.id ?? ''));
      }
    },
    { immediate: true },
  );

  function setStyle(groupId: string, value: string) {
    touched.add(groupId);
    styles.value[groupId] = value;
  }

  /** Only the shown groups, so stale choices from another mode are not sent. */
  function chosen(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const group of groups.value) {
      const value = styles.value[group.id];
      // `custom` is sent as `length` numbers instead.
      if (value && value !== 'custom') out[group.id] = value;
    }
    return out;
  }

  /** Styles, provider, model and length as every generation request takes them. */
  function requestOptions() {
    const length = lengthInput();
    return {
      styles: chosen(),
      ...(kind.value ? { providerKind: kind.value } : {}),
      ...(model.value.trim() ? { model: model.value.trim() } : {}),
      ...(length ? { length } : {}),
    };
  }

  return reactive({
    ...documentControls,
    pickerGroups,
    sizesText,
    kind,
    isCustom,
    cardModel,
    modelOptions,
    model,
    styles,
    lengthOptions,
    customWords,
    customBlocks,
    setStyle,
    requestOptions,
  });
}

/** The state `GenerationControls` edits. */
export type GenerationOptions = ReturnType<typeof useGenerationOptions>;
