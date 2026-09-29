import { SPACE_TEMPLATES, type SpaceTemplateId } from '@manablox/core';
import { computed, type Ref, ref } from 'vue';
import { type SlotItem, useSlotItems } from '~/lib/plugins/registry';

/** Website types, and the plugins' starters by key. */
export type SiteType = SpaceTemplateId | `starter:${string}`;

type StarterItem = SlotItem<'space.create.starters'>;

/**
 * The website types a preconfigured space offers: the built-in templates, then the plugins'
 * kinds of space. A picked plugin starter sends its plan and data with the create; a locked
 * one shows as a lock below the choices.
 */
export function useSpaceStarters(siteType: Ref<SiteType>) {
  const starterItems = useSlotItems('space.create.starters', { locked: true });
  const starterDrafts = ref<Record<string, Record<string, unknown>>>({});
  const starterDraft = (item: StarterItem) => starterDrafts.value[item.key] ?? {};
  const starterProps = (item: StarterItem) => ({
    draft: starterDraft(item),
    setDraft: (patch: Record<string, unknown>) => {
      starterDrafts.value = {
        ...starterDrafts.value,
        [item.key]: { ...starterDraft(item), ...patch },
      };
    },
  });
  /** Shown while their `when` holds for their draft. */
  const shownStarters = computed(() =>
    starterItems.value.filter((item) => !item.entry.when || item.entry.when(starterProps(item))),
  );
  const starters = computed(() => shownStarters.value.filter((item) => !item.locked));
  const lockedStarters = computed(() => shownStarters.value.filter((item) => item.locked));
  /** The picked plugin starter, while one is. */
  const starter = computed(() =>
    siteType.value.startsWith('starter:')
      ? (starters.value.find((item) => `starter:${item.key}` === siteType.value) ?? null)
      : null,
  );
  const siteTypes = computed(() => [
    ...SPACE_TEMPLATES.map((entry) => ({
      value: entry.id as SiteType,
      title: entry.name,
      hint: entry.description,
    })),
    ...starters.value.map((item) => ({
      value: `starter:${item.key}` as SiteType,
      title: item.entry.starter.title,
      hint: item.entry.starter.hint,
    })),
  ]);

  return { starter, starterDraft, starterProps, lockedStarters, siteTypes };
}
