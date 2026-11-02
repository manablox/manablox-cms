<script setup lang="ts">
import type { AdminSlotProps } from '@manablox/admin-plugin';
import {
  SettingsAccordion,
  type SettingsAccordionItem,
  useSessionStore,
} from '@manablox/admin-sdk';
import { computed, ref } from 'vue';
import SiteAccessPanel from '../components/SiteAccessPanel.vue';
import SiteModePanel from '../components/SiteModePanel.vue';
import SiteSpacePanel from '../components/SiteSpacePanel.vue';
import { LOCALE_STRATEGIES } from '../model/site-settings';
import { useSiteContext } from '../useSiteContext';

/** Settings -> General: the site mode, and for a designed site its 404 page, languages and password. */
const props = defineProps<AdminSlotProps['space.settings.sections']>();

const session = useSessionStore();
const { settings, designed, canSwitch } = useSiteContext();
/** Set by the controls, never here. */
const badgeShown = computed(() => session.feature('plugins.website.badge', props.space.id).enabled);

const open = ref<string[]>([]);
const sections = computed<SettingsAccordionItem[]>(() => {
  const data = settings.data.value;
  if (!data) return [];
  const mode: SettingsAccordionItem = {
    value: 'mode',
    label: 'Website',
    icon: 'palette',
    description: 'Whether Manablox renders the site or your own frontend does.',
    summary: designed.value ? 'Designed site' : 'Own frontend',
  };
  if (!designed.value) return [mode];
  const strategy = LOCALE_STRATEGIES.find((entry) => entry.value === data.localeStrategy);
  return [
    mode,
    {
      value: 'space',
      label: '404 page and languages',
      icon: 'doc',
      description: 'The page shown for unknown addresses, and how languages appear in addresses.',
      summary: `${data.notFoundContentId ? 'Own 404 page' : 'Generated 404 page'}, ${strategy?.label ?? data.localeStrategy}`,
    },
    {
      value: 'access',
      label: 'Site password',
      icon: 'lock',
      description: 'Keeps the site private until visitors enter a password.',
      summary: data.hasPassword ? 'Protected' : 'Open',
    },
  ];
});
</script>

<template>
  <div v-if="settings.data.value" class="ws:space-y-3" data-website-settings>
    <p v-if="designed && badgeShown" class="mb-callout ws:text-xs" data-site-badge>A Manablox badge is shown on this site.</p>
    <SettingsAccordion v-model="open" :items="sections">
      <template #mode>
        <SiteModePanel :space-id="space.id" :mode="settings.data.value.mode" :can-switch="canSwitch" :frontend-url="space.url" />
      </template>
      <template #space>
        <SiteSpacePanel
          :space-id="space.id"
          :locale-strategy="settings.data.value.localeStrategy"
          :not-found-content-id="settings.data.value.notFoundContentId"
          :can-edit="canSwitch"
        />
      </template>
      <template #access>
        <SiteAccessPanel :space-id="space.id" :has-password="settings.data.value.hasPassword" :can-edit="canSwitch" />
      </template>
    </SettingsAccordion>
  </div>
</template>
