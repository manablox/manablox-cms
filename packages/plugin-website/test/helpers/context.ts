import {
  createServiceContext,
  type ServiceContext,
  type ServiceContextOptions,
} from '@manablox/services/testing';
import type { WebsiteServices } from '../../src/index.js';
import { type WebsitePluginOptions, websitePlugin } from '../../src/server/plugin.js';
import { websiteServices } from '../../src/server/services/index.js';

export interface WebsiteContext extends ServiceContext {
  website: WebsiteServices;
}

export interface WebsiteContextOptions extends ServiceContextOptions {
  website?: WebsitePluginOptions;
}

/** The core service context with the website plugin loaded and its services built. */
export async function createWebsiteContext(
  name: string,
  { website: options, ...rest }: WebsiteContextOptions,
): Promise<WebsiteContext> {
  const plugin = websitePlugin(options);
  const ctx = await createServiceContext(name, {
    ...rest,
    config: {
      ...rest.config,
      plugins: [plugin, ...(rest.config?.plugins ?? [])],
    },
  });
  ctx.manablox.providePlugin(plugin.name, {
    core: { hostVerifier: ctx.hostVerifier, spaces: ctx.spaces } as never,
  });
  const website = websiteServices(options ?? {})({
    plugin: ctx.manablox.plugin(plugin.name),
    manablox: ctx.manablox,
    logger: ctx.manablox.logger,
    repos: ctx.repos,
    db: undefined as never,
    cache: undefined as never,
  });
  ctx.manablox.providePlugin(plugin.name, { services: website });
  return Object.assign(ctx, { website });
}
