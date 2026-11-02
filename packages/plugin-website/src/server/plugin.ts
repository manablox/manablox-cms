import {
  definePlugin,
  extensionPoint,
  type ManabloxPlugin,
  type PluginServerMode,
} from '@manablox/core';
import { pluginPackage } from '@manablox/core/node';
import type { PluginModeSurface, Runtime } from '@manablox/server';
import { WEBSITE } from '../shared/site.js';
import { websiteAudit } from './audit.js';
import { websiteBlocks } from './blocks.js';
import { websiteControls } from './controls.js';
import { websiteData } from './data.js';
import * as tables from './db/tables.js';
import { websiteErrors } from './errors.js';
import { registerFormsRoute } from './forms-route.js';
import { websiteLlms } from './llms.js';
import { createSiteSurface } from './mode/site.js';
import { configuredFormForwarder, type SiteFormForwarder } from './mode/site-forms.js';
import { WEBSITE_HEADERS } from './mode/site-headers.js';
import { neutral } from './mode/site-http.js';
import { type SiteRenderer, siteRenderer } from './mode/site-renderer.js';
import { websitePermissions } from './permissions.js';
import { websiteRpc } from './rpc/index.js';
import { type WebsiteServices, websiteServices } from './services/index.js';
import { websiteTypeData } from './services/site/blocks.js';
import { type WebsiteConfig, websiteFormsSecret } from './services/site/options.js';
import { assertThemesValid } from './services/theme/code.js';
import { websiteSpaceCreate } from './space-create.js';
import type { ThemeDefinition } from './theme-define.js';
import './hooks.js';
import { websiteKeys } from './keys.js';

export interface WebsitePluginOptions extends WebsiteConfig {
  /** Themes for the starter gallery; see `defineTheme`. Other plugins contribute theirs to `themes`. */
  themes?: ThemeDefinition[] | undefined;
  /** Renders pages; `@manablox/site-renderer` by default. */
  renderer?: SiteRenderer | undefined;
  /** Forwards form submissions; built from `forms` by default, `null` turns forms off. */
  forwarder?: SiteFormForwarder | null | undefined;
}

/**
 * Designed websites: the designer's tables, procedures and permissions, themes, the `website`
 * server mode, form submissions, site domains and the designed site of a new space.
 */
export function websitePlugin(options: WebsitePluginOptions = {}): ManabloxPlugin<WebsiteServices> {
  const config = configOf(options);
  const secret = websiteFormsSecret(config);
  const pkg = pluginPackage(import.meta.url);
  return definePlugin<WebsiteServices>({
    name: WEBSITE,
    description: 'Designed websites: the visual designer, themes, forms and site domains.',
    // Theme and block designs from a description, with the AI plugin's design service.
    enhances: ['ai'],
    db: {
      tables,
      migrations: pkg.migrations,
    },
    permissions: websitePermissions,
    controls: websiteControls,
    audit: websiteAudit,
    errors: websiteErrors,
    services: websiteServices(config),
    rpc: websiteRpc,
    data: websiteData,
    extensionPoints: {
      // Every theme is checked when the config loads, in every mode.
      themes: extensionPoint<ThemeDefinition>({
        description: 'Themes for the starter gallery.',
        check: (theme) => assertThemesValid([theme]),
      }),
    },
    contributions: {
      ...(options.themes?.length ? { website: { themes: options.themes } } : {}),
    },
    modes: [websiteMode(options)],
    blocks: websiteBlocks,
    contentTypeData: websiteTypeData,
    ...(secret
      ? {
          server: {
            routes: [
              {
                scopes: ['management'],
                register: (app, helpers) => registerFormsRoute(app, helpers, secret),
              },
            ],
          },
        }
      : {}),
    admin: {
      dir: pkg.adminDir,
      // The admin frames the design canvas on the website process.
      ...(config.url ? { frameOrigins: [config.url] } : {}),
    },
    llms: websiteLlms,
    spaceCreate: websiteSpaceCreate,
  });
}

/** The `website` mode: designed spaces by `Host`, plus `/media`. */
export function websiteMode(options: WebsitePluginOptions = {}): PluginServerMode<WebsiteServices> {
  const { renderer, forwarder } = options;
  const config = configOf(options);
  return {
    name: WEBSITE,
    scopes: ['media'],
    surface: ({ runtime, plugin }): PluginModeSurface => {
      const site = createSiteSurface(
        runtime,
        plugin.services.domains,
        config,
        renderer ?? siteRenderer(presetWidths(runtime)),
        forwarder !== undefined ? forwarder : configuredFormForwarder(config),
      );
      return {
        mount: site.mount,
        spaceOf: site.spaceOf,
        media: site.media,
        served: WEBSITE,
        rateRule: websiteKeys.rateLimits.ip,
        ...(config.rateLimit !== undefined ? { rateLimit: config.rateLimit } : {}),
        fallback: neutral,
        headers: WEBSITE_HEADERS,
        // Proxies ask it before issuing a certificate.
        unsuspended: (path) => path === '/_manablox/domain-check',
      };
    },
  };
}

function configOf({
  themes: _themes,
  renderer: _renderer,
  forwarder: _forwarder,
  ...config
}: WebsitePluginOptions): WebsiteConfig {
  return config;
}

/** Widths of the configured image presets. */
function presetWidths(runtime: Runtime): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, preset] of Object.entries(runtime.manablox.config.media.presets)) {
    if (typeof preset.width === 'number') out[name] = preset.width;
  }
  return out;
}
