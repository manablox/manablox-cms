<script setup lang="ts">
import { Switch, TextareaField, useSpaceStore } from '@manablox/admin-sdk';
import type { SiteSettingsDesign } from '@manablox/site';
import { computed } from 'vue';
import { withLocalized } from '../model/site-settings';
import SiteAssetInput from './SiteAssetInput.vue';

/** Default meta description, share image and robots rules. Page designs may override them. */
const props = defineProps<{ site: SiteSettingsDesign; readOnly?: boolean }>();
const emit = defineEmits<{ update: [site: SiteSettingsDesign, group?: string] }>();

const spaces = useSpaceStore();
const locales = computed(() => spaces.current?.locales ?? ['en']);

function set(patch: Partial<SiteSettingsDesign>, group?: string) {
  emit('update', { ...props.site, ...patch }, group);
}

function setDescription(locale: string, value: string) {
  const description = withLocalized(props.site.meta.description, locale, value);
  const { description: _dropped, ...meta } = props.site.meta;
  set({ meta: description ? { ...meta, description } : meta }, `description:${locale}`);
}

function setIndex(index: boolean) {
  set({ robots: { ...props.site.robots, index } });
}

function setExtra(value: string) {
  const { extra: _dropped, ...robots } = props.site.robots;
  set({ robots: value ? { ...robots, extra: value } : robots }, 'robots-extra');
}
</script>

<template>
  <div class="ws:space-y-6">
    <section class="ws:space-y-3">
      <TextareaField
        v-for="locale in locales"
        :key="locale"
        :model-value="site.meta.description?.[locale] ?? ''"
        :label="locales.length > 1 ? `Default description (${locale})` : 'Default description'"
        hint="Search engines may show it under the title. One or two sentences, about 150 characters."
        rows="3"
        :disabled="readOnly"
        @update:model-value="setDescription(locale, String($event ?? ''))"
      />
    </section>

    <section class="ws:space-y-2">
      <span class="mb-label">Default share image</span>
      <SiteAssetInput :model-value="site.meta.ogImage ?? null" label="Share image" :read-only="readOnly" @update:model-value="set({ meta: { ...site.meta, ogImage: $event } })" />
      <p class="mb-hint">Shown when a page is shared on social media. 1200 by 630 pixels fits most networks.</p>
    </section>

    <section class="ws:space-y-3">
      <span class="mb-label">Search engines</span>
      <Switch :model-value="site.robots.index" :disabled="readOnly" @update:model-value="setIndex">
        Let search engines list the site
      </Switch>
      <p v-if="!site.robots.index" class="mb-callout ws:text-xs">
        Every page says <code class="ws:font-mono">noindex, nofollow</code> and robots.txt disallows all
        crawlers. Good for a site still in the works; switch it on before launch.
      </p>
      <p v-else class="mb-hint">
        Pages may be listed and their links followed. Share-link previews are never listed.
      </p>
      <TextareaField
        :model-value="site.robots.extra ?? ''"
        label="Extra robots.txt lines"
        class="mb-input-mono"
        rows="4"
        placeholder="User-agent: GPTBot&#10;Disallow: /"
        hint="Added below Allow: / for every crawler while the site may be listed. Start a group with User-agent: to address one crawler. The sitemap line is added for you."
        :disabled="readOnly"
        @update:model-value="setExtra(String($event ?? ''))"
      />
    </section>
  </div>
</template>
