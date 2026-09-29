import { pluginClient } from '@manablox/admin-sdk';
import type { LicenseRouter } from '../server/rpc';

/** The license plugin's management router, `plugins.license`. */
export const licenseApi = pluginClient<LicenseRouter>('license');
