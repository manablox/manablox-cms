<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import { FeatureLock, RadioCard, useSessionStore } from '@manablox/admin-sdk';
import { DESIGN_PRESETS, starterThemes, THEME_CATEGORIES } from '@manablox/site';
import { computed, watch } from 'vue';
import DesignPresetCard from '../components/theme/DesignPresetCard.vue';
import ThemeCard from '../components/theme/ThemeCard.vue';
import {
  designedSiteFeature,
  type WebsiteDraft,
  websiteChoice,
  websiteDraft,
} from '../model/create-step';

/**
 * The website part of the space creation form: designed site or own frontend next to the
 * address, then for a designed site a stage with its theme and site design.
 */
const props = defineProps<AdminSlotProps['space.create.steps']>();

/** The site process's default origin. */
const SITE_URL = 'http://localhost:3200';

/** A designed site is built in the admin and served by the site process. */
const FRONTENDS = [
  {
    value: 'designed',
    title: 'Designed site',
    hint: 'Design the website in the admin with a theme; the site process serves it.',
  },
  {
    value: 'external',
    title: 'Own frontend',
    hint: 'A website you build yourself reads the content through the public API.',
  },
] as const;

const session = useSessionStore();
/** A new space has no group yet, so the instance decides. */
const designed = computed(() => designedSiteFeature((key) => session.feature(key, null)));
const designedSite = computed(() => designed.value.state);
const frontends = computed(() =>
  designedSite.value.enabled ? FRONTENDS : FRONTENDS.filter((entry) => entry.value !== 'designed'),
);

const draft = computed(() => websiteDraft(props.draft, designedSite.value.enabled));
const set = (patch: Partial<WebsiteDraft>) => props.setDraft(patch);

// The stage and the address follow the choice; a hand-typed address stays.
watch(
  () => draft.value.frontend,
  (frontend) => {
    props.setStage(frontend === 'designed');
    const designed = frontend === 'designed';
    props.address.describe(
      designed
        ? {
            label: 'Site URL',
            hint: "Where the site process runs (port 3200 by default). Its host becomes the site's domain.",
            required: true,
          }
        : null,
    );
    const want = designed ? SITE_URL : props.address.default;
    const other = designed ? props.address.default : SITE_URL;
    if (props.address.value === other || !props.address.value) props.address.set(want);
  },
  { immediate: true },
);

const STARTERS = starterThemes().map((entry) => ({
  value: `builtin:${entry.id}`,
  name: entry.name,
  description: entry.description,
  category: entry.category,
  theme: entry.theme,
}));
const THEME_GROUPS = THEME_CATEGORIES.map((category) => ({
  ...category,
  themes: STARTERS.filter((entry) => entry.category === category.id),
}));
const choice = computed(() => websiteChoice(draft.value));
const starterTheme = computed(() => choice.value.theme);
const chosenTheme = computed(() => STARTERS.find((entry) => entry.value === starterTheme.value));

/** Every preset fits every theme; the theme's category comes first. `''` keeps only the theme. */
const PRESET_GROUPS = THEME_CATEGORIES.map((category) => ({
  ...category,
  presets: DESIGN_PRESETS.filter((entry) => entry.category === category.id),
}));
const presetGroups = computed(() => {
  const own = chosenTheme.value?.category;
  return [...PRESET_GROUPS].sort((a, b) => Number(b.id === own) - Number(a.id === own));
});
/** Until a preset is picked by hand, it follows the theme's category. */
const designPreset = computed(() => choice.value.preset);
function pickPreset(value: string) {
  set({ preset: value, presetPicked: true });
}
</script>

<template>
  <template v-if="props.stage === 'space'">
    <fieldset>
      <legend class="mb-label">Website</legend>
      <div class="ws:grid ws:gap-2 ws:sm:grid-cols-2">
        <RadioCard
          v-for="entry in frontends"
          :key="entry.value"
          :model-value="draft.frontend"
          name="s-frontend"
          :value="entry.value"
          :title="entry.title"
          :hint="entry.hint"
          @update:model-value="set({ frontend: $event as WebsiteDraft['frontend'] })"
        />
      </div>
      <div v-if="designedSite.locked" class="ws:mt-2">
        <FeatureLock :feature="designed.key" instance :state="designedSite" label="Designed site" />
      </div>
    </fieldset>
  </template>

  <template v-else>
    <fieldset>
      <legend class="mb-label">Theme</legend>
      <p class="ws:mb-2 ws:text-2xs ws:text-surface-500">Colors, fonts and buttons. Change everything later under Design.</p>
      <div class="ws:space-y-3">
        <div v-for="group in THEME_GROUPS" :key="group.id">
          <p class="ws:mb-1.5 ws:text-2xs ws:font-semibold ws:text-surface-500">{{ group.label }} <span class="ws:font-normal">{{ group.hint }}</span></p>
          <div class="ws:grid ws:grid-cols-2 ws:gap-2 ws:sm:grid-cols-4">
            <ThemeCard
              v-for="entry in group.themes"
              :key="entry.value"
              :model-value="starterTheme"
              name="s-theme"
              :value="entry.value"
              :label="entry.name"
              :description="entry.description"
              :theme="entry.theme"
              @update:model-value="set({ theme: $event })"
            />
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset v-if="chosenTheme">
      <legend class="mb-label">Site design</legend>
      <p class="ws:mb-2 ws:text-2xs ws:text-surface-500">
        Header, footer, menus, sections and page layouts, shown in the {{ chosenTheme.name }} theme. Every design works with every theme.
      </p>
      <div class="ws:space-y-3">
        <div v-for="group in presetGroups" :key="group.id">
          <p class="ws:mb-1.5 ws:text-2xs ws:font-semibold ws:text-surface-500">
            {{ group.label }}
            <span class="ws:font-normal">{{ group.id === chosenTheme.category ? 'Made for this theme' : group.hint }}</span>
          </p>
          <div class="ws:grid ws:gap-2 ws:sm:grid-cols-4">
            <DesignPresetCard
              v-for="entry in group.presets"
              :key="entry.id"
              :model-value="designPreset"
              name="s-design"
              :preset="entry"
              :theme="chosenTheme.theme"
              @update:model-value="pickPreset"
            />
          </div>
        </div>
        <RadioCard
          :model-value="designPreset"
          name="s-design"
          value=""
          title="Theme only"
          hint="Just colors, fonts and menus; pages use plain generated designs."
          @update:model-value="pickPreset"
        />
      </div>
    </fieldset>
  </template>
</template>
