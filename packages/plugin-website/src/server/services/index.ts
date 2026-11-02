import type { PluginServicesContext } from '@manablox/core';
import type {} from '@manablox/server';
import type { ThemeDefinition } from '../theme-define.js';
import { SiteDesignService } from './design.service.js';
import { SiteDomainService } from './domain.service.js';
import { SiteSettingsService } from './settings.service.js';
import type { WebsiteConfig } from './site/options.js';
import { assertThemesUnique } from './theme/code.js';
import { SiteThemeService } from './theme.service.js';

declare module '@manablox/core' {
  /** Other plugins reach the website services with `plugins.get('website')`. */
  interface PluginServicesMap {
    website: WebsiteServices;
  }
}

/** What the website plugin's hooks, procedures, routes and modes use. */
export interface WebsiteServices {
  config: WebsiteConfig;
  designs: SiteDesignService;
  domains: SiteDomainService;
  themes: SiteThemeService;
  settings: SiteSettingsService;
}

/** Builds the services once per process. */
export function websiteServices(config: WebsiteConfig) {
  return ({ manablox, repos, plugin }: PluginServicesContext): WebsiteServices => {
    assertThemesUnique(plugin.contributions<ThemeDefinition>('themes').map(({ entry }) => entry));
    return {
      config,
      designs: new SiteDesignService(manablox, repos),
      domains: new SiteDomainService(manablox, repos, plugin.core.hostVerifier),
      themes: new SiteThemeService(manablox, repos, (spaceId) =>
        plugin.contributions<ThemeDefinition>('themes', spaceId),
      ),
      settings: new SiteSettingsService(manablox, repos),
    };
  };
}
