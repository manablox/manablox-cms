<script setup lang="ts">
import { AsyncList, Dialog, Icon, runWrite, SegmentedControl, Switch } from '@manablox/admin-sdk';
import { THEME_CATEGORIES } from '@manablox/site';
import { computed, ref, watch } from 'vue';
import { type ThemeImportReport, themes, useStarterThemes } from '../queries';
import ThemeImportTable from './ThemeImportTable.vue';
import ThemePreviewCard from './ThemePreviewCard.vue';

/** The starter gallery: built-in and code themes, applied as drafts. */
const props = defineProps<{ spaceId: string }>();
const emit = defineEmits<{ close: [] }>();

const starters = useStarterThemes(() => props.spaceId);
const chosen = ref<string | null>(null);
watch(
  () => starters.data.value,
  (list) => {
    if (!chosen.value && list?.length) chosen.value = list[0]?.id ?? null;
  },
  { immediate: true },
);
const current = computed(() => starters.data.value?.find((entry) => entry.id === chosen.value));

/** Category filter; `code` is the project's own themes. */
const category = ref('all');
const categories = computed(() => [
  { value: 'all', label: 'All' },
  ...THEME_CATEGORIES.map((entry) => ({ value: entry.id, label: entry.label })),
  ...(starters.data.value?.some((entry) => entry.category === null)
    ? [{ value: 'code', label: 'From your project' }]
    : []),
]);
const shown = computed(() =>
  (starters.data.value ?? []).filter(
    (entry) => category.value === 'all' || (entry.category ?? 'code') === category.value,
  ),
);
// A filter that hides the chosen theme picks its first one instead.
watch(shown, (list) => {
  if (list.length && !list.some((entry) => entry.id === chosen.value)) {
    chosen.value = list[0]?.id ?? null;
  }
});
const replace = ref(false);
const busy = ref(false);
const result = ref<ThemeImportReport | null>(null);

async function apply() {
  const starter = current.value;
  if (!starter) return;
  await runWrite(
    async () => {
      result.value = await themes.applyStarter(props.spaceId, starter.id, replace.value);
    },
    { busy, success: `Applied the ${starter.name} theme as drafts` },
  );
}

const includes = (designs: number, hasSite: boolean) =>
  [
    'theme',
    designs ? `${designs} ${designs === 1 ? 'design' : 'designs'}` : '',
    hasSite ? 'site settings' : '',
  ]
    .filter(Boolean)
    .join(', ');
</script>

<template>
  <Dialog title="Theme gallery" width="max-w-5xl" @close="emit('close')">
    <div class="ws:space-y-4">
      <template v-if="result">
        <ThemeImportTable :report="result" done />
        <p class="mb-hint">Nothing is live yet: look the designs over, then publish them from the overview.</p>
      </template>
      <template v-else>
        <SegmentedControl v-model="category" :options="categories" aria-label="Theme category" />
        <AsyncList
          :pending="starters.isPending.value"
          :error="starters.error.value"
          :retry="starters.refetch"
          :items="shown"
          empty-icon="palette"
          empty-title="No themes to offer"
          skeleton="grid"
        >
          <template #default="{ items }">
            <div class="ws:grid ws:gap-3 ws:sm:grid-cols-2 ws:lg:grid-cols-3">
              <button
                v-for="starter in items"
                :key="starter.id"
                type="button"
                class="ws:w-full ws:space-y-2 ws:rounded-card ws:border ws:p-2 ws:text-left"
                :class="chosen === starter.id ? 'ws:border-brand-500 ws:ring-2 ws:ring-brand-500/30' : 'ws:border-surface-200 ws:dark:border-surface-800'"
                :aria-pressed="chosen === starter.id"
                @click="chosen = starter.id"
              >
                <ThemePreviewCard :theme="starter.theme" :title="starter.name" />
                <span class="ws:block ws:px-1">
                  <span class="ws:font-medium">{{ starter.name }}</span>
                  <span v-if="starter.source === 'code'" class="mb-badge ws:ml-2" :title="starter.sourceRef ?? undefined">from code</span>
                  <span class="ws:block mb-meta">{{ starter.description }}</span>
                  <span class="ws:block mb-meta">Brings {{ includes(starter.designs, starter.hasSite) }}</span>
                </span>
              </button>
            </div>
          </template>
        </AsyncList>
        <Switch v-model="replace">Replace designs this space already has</Switch>
        <p class="mb-hint">Off, only designs nobody has stored yet are added. Either way they land as drafts; undo a change in its designer or restore a version.</p>
      </template>
    </div>

    <template #footer="{ close }">
      <button type="button" :class="result ? 'mb-btn-primary' : 'mb-btn-ghost'" @click="close">{{ result ? 'Done' : 'Cancel' }}</button>
      <button v-if="!result" type="button" class="mb-btn-primary" :disabled="!current || busy" @click="apply">
        <Icon v-if="busy" name="spinner" class="ws:animate-spin" />
        {{ busy ? 'Applying...' : current ? `Apply ${current.name}` : 'Apply' }}
      </button>
    </template>
  </Dialog>
</template>
