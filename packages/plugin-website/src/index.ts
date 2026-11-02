/** `@manablox/plugin-website`: designed websites as a Manablox plugin. */
import './server/hooks.js';
import type {} from './server/services/index.js';

export { type SiteAccessSubject, signSiteAccess, verifySiteAccess } from './server/access.js';
export {
  type AiSiteBlockInput,
  type AiSiteThemeInput,
  designSiteBlock,
  designSiteTheme,
} from './server/ai/design.js';
export {
  type SiteDesignRow,
  type SiteDesignVersionRow,
  type SiteDomainRow,
  type WebsiteRepositories,
  websiteRepos,
} from './server/db/index.js';
export type { SiteFormForwarder, SiteFormForwardResult } from './server/mode/site-forms.js';
export type {
  SitePageOptions,
  SiteRenderedPage,
  SiteRenderer,
  SiteRendererFile,
} from './server/mode/site-renderer.js';
export { type WebsitePluginOptions, websiteMode, websitePlugin } from './server/plugin.js';
export type { WebsiteRouter } from './server/rpc/index.js';
export type { SiteDesignSummary } from './server/services/design/summary.js';
export { SiteDesignService } from './server/services/design.service.js';
export { SiteDomainService } from './server/services/domain.service.js';
export type { WebsiteServices } from './server/services/index.js';
export {
  NOT_FOUND_NOMINATION,
  readSiteSettings,
  SiteSettingsService,
  type SpaceSiteSettingsInput,
} from './server/services/settings.service.js';
export type { WebsiteConfig } from './server/services/site/options.js';
export { SiteThemeService } from './server/services/theme.service.js';
export { type SiteSharePayload, signSiteShare, verifySiteShare } from './server/share.js';
export {
  defineTheme,
  type ThemeDefinition,
  type ThemeDefinitionInput,
  type ThemeDesignInput,
} from './server/theme-define.js';
export * from './shared/site.js';
