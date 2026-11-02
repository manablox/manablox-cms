import type { PluginRouterOf, PluginRpcKit } from '@manablox/api-rpc/plugin';
import type { WebsiteServices } from '../services/index.js';
import { designProcedures } from './design.js';
import { domainProcedures } from './domains.js';
import { settingsProcedures } from './settings.js';

/** `plugins.website.design.*`, `.domains.*` and `.settings.*` of the management API. */
export const websiteRpc = (kit: PluginRpcKit<WebsiteServices>) => ({
  design: designProcedures(kit),
  domains: domainProcedures(kit),
  settings: settingsProcedures(kit),
});

/** The router's type, for a typed client: `pluginClient<WebsiteRouter>('website')`. */
export type WebsiteRouter = PluginRouterOf<typeof websiteRpc>;
