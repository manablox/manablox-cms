import type { SpaceAddressField } from '@manablox/admin-plugin';
import { computed, ref } from 'vue';
import { type SlotItem, useSlotItems } from '~/lib/plugins/registry';

type StepItem = SlotItem<'space.create.steps'>;

/**
 * The plugins' steps of the space creation form. Each renders in the first stage and may have
 * a stage of its own; each sends its plugin's data in `spaces.create`, its draft by default.
 */
export function useSpaceSteps(address: SpaceAddressField) {
  /** What plugin steps put into the form, by plugin id. */
  const pluginDrafts = ref<Record<string, Record<string, unknown>>>({});
  function setPluginDraft(plugin: string, patch: Record<string, unknown>) {
    pluginDrafts.value = {
      ...pluginDrafts.value,
      [plugin]: { ...pluginDrafts.value[plugin], ...patch },
    };
  }
  const pluginSteps = useSlotItems('space.create.steps');

  /** The steps' data by plugin id; a step without data sends nothing. */
  function stepData(): Record<string, unknown> {
    const plugins: Record<string, unknown> = {};
    for (const item of pluginSteps.value) {
      const draft = pluginDrafts.value[item.plugin];
      const data = item.entry.data ? item.entry.data(draft ?? {}) : draft;
      if (data !== undefined) plugins[item.plugin] = data;
    }
    return plugins;
  }

  /** Whether each step's own stage is shown, by slot key; one that has not answered yet is. */
  const ownStages = ref<ReadonlyMap<string, boolean>>(new Map());
  function setOwnStage(key: string, shown: boolean) {
    if (ownStages.value.get(key) === shown) return;
    ownStages.value = new Map([...ownStages.value, [key, shown]]);
  }
  /** A step's props in the first stage or its own. */
  const stepProps = (item: StepItem, stage: 'space' | 'own') => ({
    draft: pluginDrafts.value[item.plugin] ?? {},
    setDraft: (patch: Record<string, unknown>) => setPluginDraft(item.plugin, patch),
    stage,
    setStage: (shown: boolean) => setOwnStage(item.key, shown),
    address,
  });

  /** The steps with a stage of their own that is shown. */
  const stageSteps = computed(() =>
    pluginSteps.value.filter((item) => item.entry.stage && ownStages.value.get(item.key) !== false),
  );

  return { pluginSteps, stepData, stepProps, stageSteps };
}
