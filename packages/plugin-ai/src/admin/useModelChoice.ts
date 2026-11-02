import { computed, type Ref, ref, watch } from 'vue';
import type { AiProviderRef } from '../sdk';
import type { useAiCatalog, useAiProviders } from './queries';

/**
 * The provider and model of one generation. The model starts as the space's configured one
 * for the job and resets to it when the provider changes; a self-hosted model is typed.
 */
export function useModelChoice(options: {
  catalog: ReturnType<typeof useAiCatalog>;
  providers: ReturnType<typeof useAiProviders>;
  /** The job's capability, `text` for a document. */
  capability: Readonly<Ref<'text' | 'image' | 'video'>>;
  initialKind: AiProviderRef | '';
}) {
  const { catalog, providers, capability } = options;
  const kind = ref<AiProviderRef | ''>(options.initialKind);

  const provider = computed(() => providers.data.value?.find((row) => row.ref === kind.value));
  const providerMeta = computed(() =>
    catalog.data.value?.providers.find((meta) => meta.kind === provider.value?.kind),
  );
  /** Self-hosted models are typed, not picked. */
  const isCustom = computed(() => provider.value?.kind === 'custom');

  /** The space's configured model for this job. */
  const cardModel = computed(
    () =>
      provider.value?.models?.[capability.value] ??
      providerMeta.value?.defaultModels?.[capability.value] ??
      '',
  );

  /** Per-generation model override; includes the configured model even if the catalogue lacks it. */
  const modelOptions = computed(() => {
    const offered = providerMeta.value?.models?.[capability.value] ?? [];
    const choices = offered.map((entry) => ({
      value: entry.id,
      label: entry.label,
      hint: entry.id === cardModel.value ? `${entry.id} - the space's usual choice` : entry.id,
    }));
    if (cardModel.value && !choices.some((option) => option.value === cardModel.value)) {
      choices.unshift({
        value: cardModel.value,
        label: cardModel.value,
        hint: "the space's usual choice",
      });
    }
    return choices;
  });

  const model = ref('');

  /** Reset the model to the configured one when the provider changes. */
  watch(
    [cardModel, kind],
    ([current]) => {
      model.value = current;
    },
    // Queries may already be cached on open.
    { immediate: true },
  );

  return { kind, isCustom, cardModel, modelOptions, model };
}
