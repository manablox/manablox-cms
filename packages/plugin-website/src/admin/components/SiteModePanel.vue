<script setup lang="ts">
import { confirmAndRun, FormField, Icon, runWrite } from '@manablox/admin-sdk';
import { computed, ref, watch } from 'vue';
import type { SiteMode } from '../../sdk';
import { design, themes, useStarterThemes } from '../queries';
import ThemePreviewCard from './ThemePreviewCard.vue';
import StarterThemeSelect from './theme/StarterThemeSelect.vue';

/**
 * Explains the designed site and switches the mode. Going designed with a starter theme
 * writes its designs as drafts first, over stored ones.
 */
const props = defineProps<{
  spaceId: string;
  mode: SiteMode;
  /** Holds `space:write`. */
  canSwitch: boolean;
  /** The space has a frontend URL of its own. */
  frontendUrl?: string | null | undefined;
}>();
const emit = defineEmits<{ switched: [mode: SiteMode] }>();

const gallery = useStarterThemes(
  () => props.spaceId,
  () => props.mode === 'external',
);
const starters = computed(() => gallery.data.value ?? []);
const starter = ref('');
// The first theme is preselected once the gallery loads.
let preselected = false;
watch(
  starters,
  (list) => {
    if (preselected || !list.length) return;
    preselected = true;
    starter.value = list[0]?.id ?? '';
  },
  { immediate: true },
);
const busy = ref(false);
const chosen = computed(() => starters.value.find((entry) => entry.id === starter.value) ?? null);
const options = computed(() =>
  starters.value.map((entry) => ({
    value: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    theme: entry.theme,
  })),
);
const KEEP = [
  {
    value: '',
    label: 'Keep what is there',
    description: 'Uses the stored theme, or the neutral default when there is none.',
  },
];

async function switchToDesigned() {
  const ok = await runWrite(
    () => themes.switchToDesigned(props.spaceId, chosen.value?.id ?? null),
    {
      busy,
      success: chosen.value
        ? `Switched to a designed site with the ${chosen.value.name} theme`
        : 'Switched to a designed site',
    },
  );
  if (ok) emit('switched', 'designed');
}

async function switchToExternal() {
  const ok = await confirmAndRun(
    {
      title: 'Use your own frontend again?',
      message:
        'The site process stops serving this space, and the visual editor frames your frontend URL again. Your designs are kept; switch back any time.',
      confirmLabel: 'Switch to own frontend',
      danger: true,
    },
    () => design.setMode(props.spaceId, 'external'),
    { busy, success: 'Switched to your own frontend' },
  );
  if (ok) emit('switched', 'external');
}
</script>

<template>
  <section v-if="mode === 'external'" class="mb-card ws:space-y-5">
    <div class="ws:flex ws:items-start ws:gap-3">
      <span class="mb-tile-iris ws:flex ws:h-10 ws:w-10 ws:shrink-0 ws:items-center ws:justify-center ws:rounded-control"><Icon name="palette" class="mb-icon-lg" /></span>
      <div class="ws:space-y-1.5">
        <h2 class="ws:font-display ws:text-lg ws:font-bold">Design the site here instead of coding it</h2>
        <p class="ws:text-sm ws:text-surface-600 ws:dark:text-surface-400">
          Right now this space feeds <template v-if="frontendUrl">the frontend at <span class="ws:font-mono">{{ frontendUrl }}</span></template><template v-else>a frontend of your own</template> through the API.
          As a designed site, Manablox renders the pages itself: you pick colors and fonts, style each block type and page type, and lay out headers, footers and menus - no code needed.
        </p>
        <p class="ws:text-sm ws:text-surface-600 ws:dark:text-surface-400">
          Nothing is lost by switching: content, the API and your designs stay, and you can switch back at any time.
        </p>
      </div>
    </div>

    <template v-if="canSwitch">
      <div class="ws:grid ws:items-start ws:gap-3 ws:sm:grid-cols-2">
        <FormField label="Start from" hint="Themes are grouped as professional, creative and personal." v-slot="{ id }">
          <StarterThemeSelect :id="id" v-model="starter" :themes="options" :extra="KEEP" />
        </FormField>
        <ThemePreviewCard v-if="chosen" :theme="chosen.theme" :title="chosen.name" />
      </div>
      <div class="ws:flex ws:flex-wrap ws:items-center ws:gap-3">
        <button type="button" class="mb-btn-primary" :disabled="busy" @click="switchToDesigned">
          <Icon name="palette" /> {{ busy ? 'Switching...' : 'Switch to a designed site' }}
        </button>
        <p class="mb-meta">The theme lands as a draft. The site shows it once you publish.</p>
      </div>
    </template>
    <p v-else class="mb-callout">Someone who can change this space's settings can switch it to a designed site.</p>
  </section>

  <div v-else-if="canSwitch" class="ws:flex ws:flex-wrap ws:items-center ws:gap-3 mb-meta">
    <span>This space is a designed site.</span>
    <button type="button" class="mb-btn-ghost mb-btn-sm" :disabled="busy" @click="switchToExternal">
      Use my own frontend instead
    </button>
  </div>
</template>
