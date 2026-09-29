<script setup lang="ts">
import PageLoader from '@manablox/admin-sdk/components/ui/PageLoader.vue';
import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import { type Component, defineAsyncComponent, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import FeatureLocked from '~/components/feature/FeatureLocked.vue';
import type { CoreSettingsSection } from '~/features/settings/sections';
import { useSettingsSections } from '~/features/settings/useSettingsSections';
import { pluginSettingsSections } from '~/lib/plugins/registry';

// Each section is its own chunk, fetched when opened.
const PANELS: Record<
  Exclude<CoreSettingsSection, 'general' | 'members' | 'transfer'>,
  Component
> = {
  roles: defineAsyncComponent(() => import('~/features/roles/components/RolesSettings.vue')),
  tags: defineAsyncComponent(() => import('~/features/tags/components/TagsSettings.vue')),
  credentials: defineAsyncComponent(
    () => import('~/features/credentials/components/CredentialsSettings.vue'),
  ),
  spaces: defineAsyncComponent(() => import('~/features/spaces/components/SpacesSettings.vue')),
  users: defineAsyncComponent(() => import('~/features/users/components/UsersSettings.vue')),
  security: defineAsyncComponent(
    () => import('~/features/security/components/SecuritySettings.vue'),
  ),
  keys: defineAsyncComponent(() => import('~/features/api-keys/components/ApiKeysSettings.vue')),
  backups: defineAsyncComponent(() => import('~/features/backups/components/BackupsSettings.vue')),
  apiHosts: defineAsyncComponent(() => import('~/features/spaces/components/ApiHostsSettings.vue')),
  environments: defineAsyncComponent(
    () => import('~/features/environments/components/EnvironmentsSettings.vue'),
  ),
  usage: defineAsyncComponent(() => import('~/features/usage/components/SpaceUsageSettings.vue')),
  instanceUsage: defineAsyncComponent(
    () => import('~/features/usage/components/InstanceUsageSettings.vue'),
  ),
};
const SpaceSettings = defineAsyncComponent(
  () => import('~/features/spaces/components/SpaceSettings.vue'),
);
const MembersSection = defineAsyncComponent(
  () => import('~/features/spaces/components/MembersSection.vue'),
);
const SpaceTransfer = defineAsyncComponent(
  () => import('~/features/spaces/components/SpaceTransfer.vue'),
);

/** A built-in section's panel, else the plugin's. */
function panelOf(id: string): Component | undefined {
  return (
    PANELS[id as keyof typeof PANELS] ??
    pluginSettingsSections().find((section) => section.id === id)?.component
  );
}

/** Settings: `?tab=` names the section, the side column lists them. Space sections act on the current space. */
const route = useRoute();
const router = useRouter();
const spaces = useSpaceStore();
const session = useSessionStore();
const { active } = useSettingsSections();

// `?space=` switches to that space and opens its settings.
watch(
  () => route.query.space,
  (asked) => {
    if (typeof asked !== 'string') return;
    if (spaces.spaces.some((space) => space.id === asked)) spaces.currentId = asked;
    const { space: _, ...rest } = route.query;
    void router.replace({ query: { ...rest, tab: rest.tab ?? 'general' } });
  },
  { immediate: true },
);
</script>

<template>
  <div class="mb-page">
    <p class="mb-eyebrow mb-2">
      {{ active.scope === 'space' ? `Settings of ${spaces.current?.name ?? 'this space'}` : 'Instance settings' }}
    </p>

    <Suspense :timeout="0">
      <div :key="`${active.id}:${active.scope === 'space' ? spaces.currentId : ''}`">
        <FeatureLocked
          v-if="active.locked && active.feature"
          :feature="active.feature"
          :state="session.feature(active.feature, spaces.currentId)"
        />
        <template v-else-if="spaces.current && active.scope === 'space'">
          <SpaceSettings v-if="active.id === 'general'" :space="spaces.current" @deleted="router.replace({ query: { tab: 'spaces' } })" />
          <MembersSection v-else-if="active.id === 'members'" :space-id="spaces.current.id" />
          <SpaceTransfer v-else-if="active.id === 'transfer'" :space="spaces.current" />
          <component :is="panelOf(active.id)" v-else />
        </template>
        <component :is="panelOf(active.id)" v-else />
      </div>
      <template #fallback>
        <PageLoader />
      </template>
    </Suspense>
  </div>
</template>
