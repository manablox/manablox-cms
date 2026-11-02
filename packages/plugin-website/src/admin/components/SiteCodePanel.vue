<script setup lang="ts">
import { FeatureGate, FeatureLock, Icon, TextareaField } from '@manablox/admin-sdk';
import type { SiteSettingsDesign } from '@manablox/site';

type CodeField = 'customCss' | 'headCode' | 'bodyEndCode';

/** Custom CSS, head and body code. Changing them needs `design:code`. */
const props = defineProps<{
  site: SiteSettingsDesign;
  /** Holds `design:code`. */
  canCode: boolean;
  readOnly?: boolean;
}>();
const emit = defineEmits<{ update: [site: SiteSettingsDesign, group?: string] }>();

function set(field: CodeField, value: string) {
  const { [field]: _dropped, ...rest } = props.site;
  emit('update', value ? { ...rest, [field]: value } : rest, field);
}
</script>

<template>
  <div class="ws:space-y-6">
    <p v-if="!canCode" class="mb-callout ws:flex ws:items-start ws:gap-2 ws:text-xs">
      <Icon name="lock" class="mb-icon-sm ws:mt-0.5 ws:shrink-0" />
      <span>Only people with the "Edit custom CSS and head code" permission (admins by default) can change these. You can read them.</span>
    </p>

    <TextareaField
      :model-value="site.customCss ?? ''"
      label="Custom CSS"
      class="mb-input-mono"
      rows="12"
      spellcheck="false"
      placeholder=".mb-button { letter-spacing: 0.02em; }"
      :disabled="readOnly || !canCode"
      @update:model-value="set('customCss', String($event ?? ''))"
    >
      <template #hint>
        <p class="mb-hint">Added after the theme and design rules, so it wins over them. Theme values are available as
        custom properties such as <code class="ws:font-mono">var(--mb-color-primary)</code>.</p>
      </template>
    </TextareaField>

    <FeatureGate feature="plugins.website.headCode">
      <div class="ws:space-y-6">
        <p v-if="canCode" class="mb-callout ws:text-xs" role="note">
          Code below runs on every page of the public site, with full access to what visitors see and type.
          Only paste snippets you trust, such as analytics or a chat widget from its official instructions.
          Pages with code here are served with a relaxed Content Security Policy.
        </p>

        <TextareaField
          :model-value="site.headCode ?? ''"
          label="Code in head"
          class="mb-input-mono"
          rows="6"
          spellcheck="false"
          placeholder="&lt;script defer src=&quot;https://analytics.example/script.js&quot;&gt;&lt;/script&gt;"
          hint="HTML added at the end of every page's head: meta tags, stylesheets, analytics."
          :disabled="readOnly || !canCode"
          @update:model-value="set('headCode', String($event ?? ''))"
        />

        <TextareaField
          :model-value="site.bodyEndCode ?? ''"
          label="Code at the end of the body"
          class="mb-input-mono"
          rows="6"
          spellcheck="false"
          hint="HTML added just before the closing body tag: chat widgets and scripts that need the page."
          :disabled="readOnly || !canCode"
          @update:model-value="set('bodyEndCode', String($event ?? ''))"
        />
      </div>
      <template #locked="{ state }">
        <div class="ws:flex ws:items-center ws:gap-2">
          <p class="mb-label ws:flex-1">Code in head and at the end of the body</p>
          <FeatureLock feature="plugins.website.headCode" :state="state" label="Locked" align="end" />
        </div>
      </template>
    </FeatureGate>
  </div>
</template>
