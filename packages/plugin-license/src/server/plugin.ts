import {
  definePlugin,
  extensionPoint,
  type ManabloxPlugin,
  onHook,
  pluginId,
} from '@manablox/core';
import { pluginPackage } from '@manablox/core/node';
import { PREMIUM_PRODUCT_IDS } from '@manablox/license';
import type { LicenseHostnameEntry, LicenseProductEntry } from '../sdk.js';
import { licenseAudit } from './audit.js';
import { type LicensePluginOptions, licenseConfig } from './config.js';
import * as tables from './db/tables.js';
import { licenseErrors } from './errors.js';
import { HOSTNAMES_POINT, LICENSE, PRODUCTS_POINT, REFRESH_TASK, RELOAD_CHANNEL } from './keys.js';
import { licenseRpc } from './rpc.js';
import { type LicenseServices, licenseServices } from './services/index.js';

/** The maintenance task's interval: it refreshes leases older than a day or near their end. */
const REFRESH_EVERY_MS = 6 * 60 * 60_000;

/** Refuses a product entry that is not a premium product or names another plugin's features. */
function checkProduct(entry: LicenseProductEntry, contributor: string): void {
  if (!PREMIUM_PRODUCT_IDS.includes(entry.product)) {
    throw new Error(`${contributor}: ${String(entry.product)} is not a premium product`);
  }
  const own = `plugins.${pluginId(contributor)}`;
  if (!Array.isArray(entry.lapse) || entry.lapse.length === 0) {
    throw new Error(`${contributor}: the ${entry.product} product needs a lapse set`);
  }
  for (const key of entry.lapse) {
    if (key !== own && !key.startsWith(`${own}.`)) {
      throw new Error(`${contributor}: ${key} is not one of its features (${own}...)`);
    }
  }
}

/**
 * License keys for the premium plugins: activations on the license server, the leases every
 * process verifies offline, and a feature ceiling that switches a product's lapse set off
 * while no valid lease covers it. Plugins name their product in `license.products`.
 */
export function licensePlugin(options: LicensePluginOptions = {}): ManabloxPlugin<LicenseServices> {
  const pkg = pluginPackage(import.meta.url);
  const config = licenseConfig(options);
  return definePlugin<LicenseServices>({
    name: LICENSE,
    description: 'License keys for the premium plugins, and the features they unlock.',
    db: { tables, migrations: pkg.migrations },
    audit: licenseAudit,
    errors: licenseErrors,
    extensionPoints: {
      [PRODUCTS_POINT]: extensionPoint<LicenseProductEntry>({
        description: 'The premium product a plugin sells and the features that lock without it.',
        check: checkProduct,
      }),
      [HOSTNAMES_POINT]: extensionPoint<LicenseHostnameEntry>({
        description: 'Hostnames a plugin serves, for telling development from production.',
        check(entry, contributor) {
          if (typeof entry.hostnames !== 'function') {
            throw new Error(`${contributor}: a license hostnames entry needs hostnames()`);
          }
        },
      }),
    },
    services: licenseServices(config),
    // Every process reads the leases before it serves, and again when another one wrote them.
    hooks: (plugin) => [
      onHook('before:start', async () => {
        const { licenses } = plugin.services;
        plugin.manablox.onDispose(() => licenses.close());
        await licenses.boot(plugin.channel(RELOAD_CHANNEL));
      }),
    ],
    ceilings: (plugin) => plugin.services.licenses.ceiling(),
    // In the background: the license server may be slow or away, the boot does not wait.
    start: (plugin) => {
      plugin.services.licenses.reconcile().catch((error: unknown) => {
        plugin.logger.error({ err: error }, 'license keys not reconciled');
      });
    },
    maintenance: [
      {
        name: REFRESH_TASK,
        every: REFRESH_EVERY_MS,
        run: (plugin) => plugin.services.licenses.maintain(),
      },
    ],
    rpc: licenseRpc,
    admin: { dir: pkg.adminDir },
  });
}
