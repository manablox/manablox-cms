import { useCan, useFeature, useSpaceStore } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { siteOrigins } from './model/canvas';
import { siteLink } from './model/site-links';
import { useSiteDomains, useSiteSettings } from './queries';

/**
 * The current space's site mode, site origins and design permissions. Writing and publishing
 * also need designing on: while it is locked the designers open read-only.
 */
export function useSiteContext() {
  const settings = useSiteSettings();
  const canRead = useCan('website:read');
  const mayWrite = useCan('website:write');
  const mayPublish = useCan('website:publish');
  const designing = useFeature('plugins.website.design');
  const domains = useSiteDomains(canRead);
  const origins = computed(() =>
    siteOrigins(settings.data.value?.siteUrl, domains.data.value ?? []),
  );
  const spaces = useSpaceStore();
  return {
    settings,
    domains,
    mode: computed(() => settings.data.value?.mode ?? 'external'),
    designed: computed(() => settings.data.value?.mode === 'designed'),
    /** Frames the design canvas. */
    canvasOrigin: computed(() => origins.value.canvas),
    /** The public site, when a domain is set up. */
    liveOrigin: computed(() => origins.value.live),
    /** Links documents like the site: locale prefix or the locale's own domain. */
    link: computed(() =>
      siteLink({
        defaultLocale: spaces.current?.defaultLocale ?? '',
        localeStrategy: settings.data.value?.localeStrategy ?? 'prefix',
        domains: domains.data.value ?? [],
        siteUrl: settings.data.value?.siteUrl,
      }),
    ),
    canRead,
    canWrite: computed(() => mayWrite.value && designing.value.enabled),
    canPublish: computed(() => mayPublish.value && designing.value.enabled),
    /** Designing is off with a lock: the designers say why they are read-only. */
    designLocked: computed(() => designing.value.locked),
    canSwitch: useCan('space:write'),
  };
}
