import type { WorkingEnvironment } from '@manablox/admin-plugin';
import { isProduction, useCan } from '@manablox/admin-sdk';
import { computed } from 'vue';
import { siteOrigins } from './model/canvas';
import { useSiteDomains, useSiteSettings } from './queries';

/** Where "Visit site" opens in a staging environment: its primary domain, `null` while it has none. */
export function useSiteAddress(environment: () => WorkingEnvironment) {
  const canRead = useCan('website:read');
  const staging = computed(() => !isProduction(environment().machineName));
  const stagingSpace = () => (staging.value ? environment().spaceId : null);
  const settings = useSiteSettings(stagingSpace);
  const domains = useSiteDomains(canRead, stagingSpace);
  return computed(() =>
    staging.value ? siteOrigins(settings.data.value?.siteUrl, domains.data.value ?? []).live : null,
  );
}
