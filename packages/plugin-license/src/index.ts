/** `@manablox/plugin-license`: license keys for the premium plugins, as a Manablox plugin. */
import type {} from './server/services/index.js';

export * from './sdk.js';
export {
  DEFAULT_LICENSE_SERVER,
  type LicenseConfig,
  type LicensePluginOptions,
  licenseConfig,
} from './server/config.js';
export * from './server/db/index.js';
export { licenseErrors } from './server/errors.js';
export * from './server/keys.js';
export { licensePlugin } from './server/plugin.js';
export type { LicenseRouter } from './server/rpc.js';
export type { LicenseServices } from './server/services/index.js';
export type { Entitlement } from './server/services/license/state.js';
export { LicenseService } from './server/services/license.service.js';
