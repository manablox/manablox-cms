<script setup lang="ts">
import { FormField } from '@manablox/admin-sdk';
import type { ThemeDesign } from '@manablox/site';
import { computed, ref } from 'vue';
import type { AiAdminApi, AiDesignRun } from '../model/ai-api';
import { contrastProblems, mergeAiTheme, roleSwatches } from '../model/ai-theme';
import { toHex } from '../model/color';
import { type AiThemeResult, themes } from '../queries';
import ColorInput from './ColorInput.vue';
import ThemePreviewCard from './ThemePreviewCard.vue';

/**
 * Proposes theme tokens from a description or a brand color. Nothing is saved here: Apply
 * hands the merged theme to the editor, whose undo takes it back.
 */
const props = defineProps<{
  /** The AI plugin's admin api. */
  ai: AiAdminApi;
  spaceId: string;
  theme: ThemeDesign;
}>();
const emit = defineEmits<{ close: []; apply: [theme: ThemeDesign] }>();

const brandColor = ref('');
const brandHex = computed(() => (brandColor.value.trim() ? toHex(brandColor.value) : null));

const run: AiDesignRun<AiThemeResult> = props.ai.useDesignRun(
  (input) =>
    themes.aiTheme(props.spaceId, {
      ...input,
      ...(brandHex.value ? { brandColor: brandHex.value } : {}),
    }),
  { ready: () => Boolean(run.prompt.value.trim() || brandHex.value) },
);
const result = run.result;

const proposed = computed(() =>
  result.value ? mergeAiTheme(props.theme, result.value.theme) : null,
);
const swatches = computed(() => (proposed.value ? roleSwatches(proposed.value) : []));
const contrast = computed(() => (proposed.value ? contrastProblems(proposed.value) : []));

function apply() {
  if (!proposed.value) return;
  emit('apply', proposed.value);
  emit('close');
}
</script>

<template>
  <component
    :is="ai.DesignDialog"
    title="Design a theme with AI"
    :space-id="spaceId"
    :run="run"
    label="What should the site feel like?"
    prompt-class="ws:min-h-24"
    placeholder="A calm, trustworthy bakery: warm neutrals, a friendly rounded serif for headings, generous spacing."
    hint="Colors, fonts, type scale, corners and shadows are proposed. Spacing and element styles stay as they are."
    @close="emit('close')"
  >
    <template #form>
      <FormField label="Brand color" hint="Optional; the palette is built around it." v-slot="{ id }">
        <ColorInput :id="id" :model-value="brandColor" placeholder="#1d4ed8" @update:model-value="brandColor = $event" />
      </FormField>
    </template>

    <template #result>
      <template v-if="result && proposed">
        <div class="ws:grid ws:gap-4 ws:sm:grid-cols-2">
          <div class="ws:space-y-2">
            <p class="mb-label">{{ result.name || 'Proposed theme' }}</p>
            <ThemePreviewCard :theme="proposed" :title="result.name || undefined" />
            <p v-if="result.notes" class="ws:text-sm ws:text-surface-600 ws:dark:text-surface-400">{{ result.notes }}</p>
          </div>
          <div class="ws:space-y-2">
            <p class="mb-label">Colors</p>
            <ul class="ws:grid ws:grid-cols-2 ws:gap-1.5 ws:text-xs">
              <li v-for="swatch in swatches" :key="swatch.role" class="ws:flex ws:items-center ws:gap-2">
                <span class="ws:h-5 ws:w-5 ws:shrink-0 ws:rounded-control ws:border ws:border-surface-200 ws:dark:border-surface-700" :style="{ background: swatch.color ?? 'transparent' }" />
                <span class="ws:min-w-0 ws:truncate">{{ swatch.label }}</span>
                <span class="ws:ml-auto ws:font-mono ws:text-surface-500">{{ swatch.color }}</span>
              </li>
            </ul>
            <p v-if="contrast.length === 0" class="ws:text-xs ws:text-ok-700 ws:dark:text-ok-500">Every text and background pair is readable.</p>
            <ul v-else class="mb-callout ws:space-y-0.5 ws:text-xs" role="status">
              <li v-for="check in contrast" :key="`${check.label}-${check.dark}`">
                {{ check.label }}{{ check.dark ? ' (dark scheme)' : '' }}: contrast {{ check.ratio?.toFixed(1) }} is low
              </li>
            </ul>
          </div>
        </div>
        <ul v-if="result.problems.length" class="mb-meta ws:space-y-0.5">
          <li v-for="problem in result.problems" :key="problem">{{ problem }}</li>
        </ul>
      </template>
    </template>

    <template #primary>
      <button type="button" class="mb-btn-primary" :disabled="!proposed || run.busy.value" @click="apply">Apply to the draft</button>
    </template>
  </component>
</template>
