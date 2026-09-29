import { type ManabloxRouter, router } from '@manablox/api-rpc';
import { type PluginRouter, pluginRpcKit, unguardedProcedures } from '@manablox/api-rpc/plugin';
import { ManabloxError, type ManabloxPlugin, pluginId } from '@manablox/core';

/** The management router with each plugin's `rpc` under `plugins.<id>`. */
export function managementRouter(
  plugins: readonly ManabloxPlugin[],
): ManabloxRouter & { plugins?: Record<string, PluginRouter> } {
  const routers: Record<string, PluginRouter> = {};
  const owners = new Map<string, string>();
  for (const plugin of plugins) {
    if (!plugin.rpc) continue;
    const id = pluginId(plugin.name);
    const other = owners.get(id);
    if (other !== undefined) {
      throw ManabloxError.conflict('plugin.id.duplicate', { id, plugins: [other, plugin.name] });
    }
    owners.set(id, plugin.name);
    const built = plugin.rpc(pluginRpcKit(plugin));
    // Every procedure needs the kit's flag gate and plugin context.
    const unguarded = unguardedProcedures(built);
    if (unguarded.length > 0) {
      throw ManabloxError.badRequest('plugin.rpc.unguarded', {
        plugin: plugin.name,
        procedures: unguarded,
      });
    }
    routers[id] = built;
  }
  return owners.size > 0 ? { ...router, plugins: routers } : router;
}
