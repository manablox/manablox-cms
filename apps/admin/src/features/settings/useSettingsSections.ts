import { useSessionStore } from '@manablox/admin-sdk/stores/session';
import { useSpaceStore } from '@manablox/admin-sdk/stores/space';
import type { FeatureKey } from '@manablox/core';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { pluginSettingsSections } from '~/lib/plugins/registry';
import { availableSections, resolveSection, type SettingsSection } from './sections';

/** The sections the viewer may open and the one `?tab=` names. */
export function useSettingsSections() {
  const route = useRoute();
  const session = useSessionStore();
  const spaces = useSpaceStore();

  const sections = computed(() =>
    availableSections({
      isSuperadmin: session.isSuperadmin,
      hasSpace: Boolean(spaces.current),
      importing: spaces.currentImporting,
      can: (permission) => session.can(permission, spaces.currentId),
      feature: (key) => session.feature(key, spaces.currentId),
      extra: pluginSettingsSections().map((section) => ({
        id: section.id as SettingsSection,
        label: section.label,
        icon: section.icon,
        scope: section.scope ?? 'space',
        ...(section.permission ? { permission: section.permission } : {}),
        ...(section.superadmin ? { superadmin: true } : {}),
        feature: section.feature as FeatureKey,
      })),
    }),
  );
  // The create and import links open their dialog on Spaces.
  const active = computed(() =>
    resolveSection(
      route.query.new || route.query.import ? 'spaces' : route.query.tab,
      sections.value,
    ),
  );

  return { sections, active };
}
