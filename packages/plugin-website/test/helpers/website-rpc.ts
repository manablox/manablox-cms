import { type PluginRpcContext, pluginRpcKit } from '@manablox/api-rpc/plugin';
import type { Principal } from '@manablox/auth';
import { resolveConfig } from '@manablox/core';
import { websitePlugin } from '../../src/server/plugin.js';
import { websiteRpc } from '../../src/server/rpc/index.js';
import type { WebsiteServices } from '../../src/server/services/index.js';
import { fakeAiPlugin } from './fake-ai.js';
import { stubContext } from './rpc.js';

// Registers the plugins' permissions, as booting does; AI's for the AI designs.
resolveConfig({
  database: { url: 'postgres://localhost/test' },
  auth: { secret: 'x'.repeat(32) },
  plugins: [fakeAiPlugin(), websitePlugin()],
});

/** `plugins.website` of the management router. */
export const website = websiteRpc(pluginRpcKit(websitePlugin()));

/** A stub context whose website plugin has the given services. */
export function pluginContext(
  services: Partial<Record<keyof WebsiteServices, unknown>>,
  who: Principal,
): PluginRpcContext<WebsiteServices> {
  const ctx = stubContext({ principal: who });
  const manablox = ctx.manablox as unknown as Record<string, unknown>;
  manablox.plugin = () => ({ services: { config: {}, ...services } });
  return ctx as PluginRpcContext<WebsiteServices>;
}
