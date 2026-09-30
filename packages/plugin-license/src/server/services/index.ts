import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Contribution, type PluginServicesContext, pluginId } from '@manablox/core';
import { pluginPackage } from '@manablox/core/node';
import { hostnameOf, type PremiumProduct } from '@manablox/license';
import type {} from '@manablox/server';
import type { LicenseHostnameEntry, LicenseProductEntry } from '../../sdk.js';
import type { LicenseConfig } from '../config.js';
import { HOSTNAMES_POINT, PRODUCTS_POINT, RELOAD_CHANNEL } from '../keys.js';
import type { Entitlement } from './license/state.js';
import { LicenseService } from './license.service.js';

declare module '@manablox/core' {
  /** The paid plugins reach the entitlements with `plugins.get('license')`. */
  interface PluginServicesMap {
    license: LicenseServices;
  }

  interface PluginContributions {
    license: { products: LicenseProductEntry; hostnames: LicenseHostnameEntry };
  }
}

/** The plugin's services; others reach them with `plugins.get('license')`. */
export interface LicenseServices {
  licenses: LicenseService;
  /** What a product's license allows now: its state, kind, period end and lease expiry. */
  entitlement(product: PremiumProduct): Entitlement;
  /** False for a non-private host while only a development lease covers the product. */
  allowsHost(product: PremiumProduct, host: string): boolean;
  /**
   * Reads the leases and hostnames again in every process of the instance. A plugin that
   * contributes `license.hostnames` calls it once they changed; spaces and API hosts reload on
   * their own.
   */
  reload(): Promise<void>;
}

/** The release this package belongs to; every `@manablox/*` package shares it. */
function releaseVersion(): string {
  try {
    const manifest = join(pluginPackage(import.meta.url).root, 'package.json');
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Builds the license service once per process. */
export function licenseServices(config: LicenseConfig) {
  return (context: PluginServicesContext): LicenseServices => {
    const { manablox, plugin, logger } = context;
    const products = () => plugin.contributions<LicenseProductEntry>(PRODUCTS_POINT);
    const { server, auth } = manablox.config;
    const configured = [server.publicUrl, server.adminUrl, auth.baseUrl ?? '']
      .map(hostnameOf)
      .filter(Boolean);

    /**
     * The configured URLs' hostnames, the spaces' URLs and API hosts, and those the plugins
     * serve; a failing source counts as public.
     */
    const hostnames = async (): Promise<string[]> => {
      const sources = plugin.contributions<LicenseHostnameEntry>(HOSTNAMES_POINT);
      const found = await Promise.all([
        spaceHostnames(),
        ...sources.map((source) => contributed(source)),
      ]);
      return [...new Set([...configured, ...found.flat()])];
    };
    const spaceHostnames = async (): Promise<string[]> => {
      try {
        const [spaces, apiHosts] = await Promise.all([
          context.repos.spaces.list(),
          context.repos.spaceApiHosts.hostnames(),
        ]);
        return [...spaces.map((space) => space.url), ...apiHosts].map(hostnameOf).filter(Boolean);
      } catch (error) {
        logger.error({ err: error }, 'space hostnames not read; counted as public');
        return [''];
      }
    };
    const contributed = async ({
      plugin: id,
      entry,
    }: Contribution<LicenseHostnameEntry>): Promise<string[]> => {
      try {
        const owner = manablox.config.plugins.find((entry) => pluginId(entry.name) === id);
        if (!owner) return [];
        return (await entry.hostnames(manablox.plugin(owner.name))).map(hostnameOf);
      } catch (error) {
        logger.error({ err: error, plugin: id }, 'license hostnames not read; counted as public');
        return [''];
      }
    };

    const version = releaseVersion();
    const versions: Record<string, string> = { manablox: version };
    for (const { plugin: id } of products()) {
      const owner = manablox.config.plugins.find((entry) => pluginId(entry.name) === id);
      versions[id] = owner?.version ?? version;
    }

    const licenses = new LicenseService({
      config,
      repos: context.repos,
      logger,
      secret: auth.secret,
      instanceId: () => manablox.instance.id,
      products,
      hostnames,
      versions,
      adminHostname: hostnameOf(server.adminUrl) || undefined,
      publish: () => plugin.channel(RELOAD_CHANNEL).publish({}),
      nodeEnv: process.env.NODE_ENV,
    });
    return {
      licenses,
      entitlement: (product) => licenses.entitlement(product),
      allowsHost: (product, host) => licenses.allowsHost(product, host),
      reload: () => licenses.reload(),
    };
  };
}
