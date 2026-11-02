<script setup lang="ts">
import { TextField, useSpaceStore } from '@manablox/admin-sdk';
import type { SiteSettingsDesign } from '@manablox/site';
import { computed } from 'vue';
import {
  DEFAULT_TITLE_PATTERN,
  titlePatternWarnings,
  titlePreview,
  withLocalized,
} from '../model/site-settings';
import SiteAssetInput from './SiteAssetInput.vue';

/** Site name, logo, favicon and the page title pattern. */
const props = defineProps<{ site: SiteSettingsDesign; readOnly?: boolean }>();
const emit = defineEmits<{ update: [site: SiteSettingsDesign, group?: string] }>();

const spaces = useSpaceStore();
const locales = computed(() => spaces.current?.locales ?? ['en']);
const siteName = computed(() => props.site.name || spaces.current?.name || 'My site');

const SAMPLE_TITLE = 'About us';
const preview = computed(() => titlePreview(props.site.titlePattern, SAMPLE_TITLE, siteName.value));
const homePreview = computed(() => titlePreview(props.site.titlePattern, '', siteName.value));
const warnings = computed(() => titlePatternWarnings(props.site.titlePattern));

function set(patch: Partial<SiteSettingsDesign>, group?: string) {
  emit('update', { ...props.site, ...patch }, group);
}

function setLogo(assetId: string | null) {
  set({ logo: assetId ? { ...(props.site.logo ?? {}), assetId } : null });
}

function setLogoAlt(locale: string, value: string) {
  const logo = props.site.logo;
  if (!logo) return;
  const alt = withLocalized(logo.alt, locale, value);
  const { alt: _dropped, ...rest } = logo;
  set({ logo: alt ? { ...rest, alt } : rest }, `logo-alt:${locale}`);
}
</script>

<template>
  <div class="ws:space-y-6">
    <TextField
      :model-value="site.name"
      label="Site name"
      :placeholder="spaces.current?.name"
      hint="Shown by the logo element and in page titles. Empty uses the space name."
      :disabled="readOnly"
      :maxlength="200"
      @update:model-value="set({ name: String($event ?? '') }, 'name')"
    />

    <section class="ws:space-y-2">
      <span class="mb-label">Logo</span>
      <SiteAssetInput :model-value="site.logo?.assetId ?? null" label="Logo" :read-only="readOnly" @update:model-value="setLogo" />
      <div v-if="site.logo" class="ws:grid ws:gap-3 ws:sm:grid-cols-2">
        <TextField
          v-for="locale in locales"
          :key="locale"
          :model-value="site.logo.alt?.[locale] ?? ''"
          :label="locales.length > 1 ? `Alt text (${locale})` : 'Alt text'"
          placeholder="What the logo says, for screen readers"
          :disabled="readOnly"
          @update:model-value="setLogoAlt(locale, String($event ?? ''))"
        />
      </div>
      <p class="mb-hint">Layouts place it with the logo element; without one they show the site name.</p>
    </section>

    <section class="ws:space-y-2">
      <span class="mb-label">Favicon</span>
      <SiteAssetInput :model-value="site.favicon ?? null" label="Favicon" :read-only="readOnly" @update:model-value="set({ favicon: $event })" />
      <p class="mb-hint">The small icon in browser tabs. A square PNG or SVG of at least 48 pixels works best.</p>
    </section>

    <section class="ws:space-y-2">
      <TextField
        :model-value="site.titlePattern"
        label="Page title pattern"
        class="mb-input-mono"
        :placeholder="DEFAULT_TITLE_PATTERN"
        :disabled="readOnly"
        :maxlength="200"
        @update:model-value="set({ titlePattern: String($event ?? '') }, 'titlePattern')"
      >
        <template #hint>
          <p class="mb-hint"><code class="ws:font-mono">{title}</code> is the page's title, <code class="ws:font-mono">{site}</code> the site name.
          Empty uses <code class="ws:font-mono">{{ DEFAULT_TITLE_PATTERN }}</code>.</p>
        </template>
      </TextField>
      <div class="mb-surface-inset ws:space-y-1 ws:rounded-control ws:px-3 ws:py-2 ws:text-xs" aria-live="polite">
        <p><span class="ws:text-surface-500">A page called "{{ SAMPLE_TITLE }}":</span> <span class="ws:font-medium">{{ preview }}</span></p>
        <p><span class="ws:text-surface-500">A page without a title:</span> <span class="ws:font-medium">{{ homePreview }}</span></p>
      </div>
      <ul v-if="warnings.length" class="ws:space-y-1 ws:text-xs ws:text-warn-700 ws:dark:text-warn-300">
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
    </section>
  </div>
</template>
