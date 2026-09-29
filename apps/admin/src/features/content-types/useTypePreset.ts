import { confirm } from '@manablox/admin-sdk/lib/confirm';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { computed, type Ref, ref, watch } from 'vue';
import { useSlotItems } from '~/lib/plugins/registry';
import type { ContentTypeDraft } from './model';
import { presetFields, presetsFor, TYPE_PRESETS, type TypePreset } from './presets';

/**
 * A new type's starting point: `blank`, a built-in preset or a plugin's. Picking one swaps
 * the fields (after asking when they were edited by hand) and carries label and icon along.
 */
export function useTypePreset(
  draft: Ref<ContentTypeDraft | null | undefined>,
  /** Sets the label the way typing it does, so the name follows. */
  setLabel: (label: string) => void,
) {
  const spaces = useSpaceStore();

  /** Presets from plugins; the picked one's component shows below the picker. */
  const pluginPresets = useSlotItems('contentType.presets');
  const presetById = (id: string): TypePreset | undefined =>
    [...TYPE_PRESETS, ...pluginPresets.value.map((item) => item.entry.preset)].find(
      (entry) => entry.id === id,
    );
  /** The picked plugin preset, while one is. */
  const pickedPlugin = computed(
    () => pluginPresets.value.find((item) => item.entry.preset.id === preset.value) ?? null,
  );
  /** The picked plugin preset's own state. */
  const presetDraft = ref<Record<string, unknown>>({});
  function setPresetDraft(patch: Record<string, unknown>) {
    presetDraft.value = { ...presetDraft.value, ...patch };
  }

  /** The new type's starting point: `blank` or a preset id. */
  const preset = ref('blank');
  /** Presets whose name no type has yet. */
  const presets = computed(() => {
    if (!draft.value || draft.value.id) return [];
    const taken = new Set(spaces.contentTypes.map((type) => type.name));
    return presetsFor(
      draft.value.kind,
      taken,
      pluginPresets.value.map((item) => item.entry.preset),
    );
  });
  /** The fields as the preset set them, to tell hand edits apart. */
  let presetFieldsJson = '[]';

  function resetPreset() {
    preset.value = 'blank';
    presetFieldsJson = '[]';
    presetDraft.value = {};
  }

  watch(() => draft.value?.kind, resetPreset);

  async function choosePreset(id: string) {
    const current = draft.value;
    if (!current || id === preset.value) return;
    const edited = current.fields.length > 0 && JSON.stringify(current.fields) !== presetFieldsJson;
    if (
      edited &&
      !(await confirm({
        title: 'Replace the fields?',
        message:
          'The current fields, with your changes, are swapped for the ones this starting point brings.',
        confirmLabel: 'Replace',
      }))
    ) {
      return;
    }

    const previous = presetById(preset.value);
    const next = presetById(id);
    preset.value = id;
    presetDraft.value = {};
    current.fields = next ? presetFields(next) : [];
    presetFieldsJson = JSON.stringify(current.fields);
    // Label and icon follow the preset unless set by hand.
    if (!current.label || current.label === previous?.label) setLabel(next?.label ?? '');
    if (!current.icon || current.icon === previous?.icon) current.icon = next?.icon;
    if (current.kind !== 'block' && previous?.isPublishable !== next?.isPublishable) {
      current.isPublishable = next?.isPublishable ?? true;
    }
  }

  return {
    preset,
    presets,
    pickedPlugin,
    presetDraft,
    setPresetDraft,
    resetPreset,
    choosePreset,
  };
}
