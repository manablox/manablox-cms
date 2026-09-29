/** Plugin dependencies: `requires` and `enhances`, and the boot order they give. */

import { ManabloxError } from './errors.js';
import { type ManabloxPlugin, pluginId } from './plugin.js';
import { CLI_CORE_COMMANDS } from './plugin-cli.js';

const RESERVED: ReadonlySet<string> = new Set(CLI_CORE_COMMANDS);

/**
 * The plugins in boot order: each after the plugins it `requires`, and after those it
 * `enhances` where that forms no cycle; otherwise in config order. Refuses a `requires` naming
 * a plugin that is not configured, a cycle of `requires`, and a plugin whose id is a core
 * `manablox` command (`manablox <id>` runs a plugin's commands).
 */
export function orderPlugins(plugins: readonly ManabloxPlugin[]): ManabloxPlugin[] {
  const byId = new Map<string, ManabloxPlugin>();
  for (const plugin of plugins) {
    const id = pluginId(plugin.name);
    if (RESERVED.has(id)) {
      throw ManabloxError.badRequest('plugin.id.reserved', { plugin: plugin.name, id });
    }
    if (!byId.has(id)) byId.set(id, plugin);
  }
  const hard = new Map<ManabloxPlugin, ManabloxPlugin[]>();
  const soft = new Map<ManabloxPlugin, ManabloxPlugin[]>();
  for (const plugin of plugins) {
    hard.set(
      plugin,
      (plugin.requires ?? []).map((id) => {
        const target = byId.get(id);
        if (!target) {
          throw ManabloxError.badRequest('plugin.requires.missing', {
            plugin: plugin.name,
            requires: id,
          });
        }
        return target;
      }),
    );
    soft.set(
      plugin,
      (plugin.enhances ?? []).flatMap((id) => {
        const target = byId.get(id);
        return target && target !== plugin ? [target] : [];
      }),
    );
  }
  assertNoCycle(plugins, hard);

  // Config order among the plugins that are ready; a soft link gives way when nothing is.
  const out: ManabloxPlugin[] = [];
  const placed = new Set<ManabloxPlugin>();
  const ready = (plugin: ManabloxPlugin, links: Map<ManabloxPlugin, ManabloxPlugin[]>[]) =>
    links.every((map) => (map.get(plugin) ?? []).every((target) => placed.has(target)));
  while (out.length < plugins.length) {
    const open = plugins.filter((plugin) => !placed.has(plugin));
    const next =
      open.find((plugin) => ready(plugin, [hard, soft])) ??
      (open.find((plugin) => ready(plugin, [hard])) as ManabloxPlugin);
    placed.add(next);
    out.push(next);
  }
  return out;
}

/** Throws `plugin.requires.cycle` naming the plugins of the first `requires` cycle found. */
function assertNoCycle(
  plugins: readonly ManabloxPlugin[],
  hard: Map<ManabloxPlugin, ManabloxPlugin[]>,
): void {
  const done = new Set<ManabloxPlugin>();
  const path: ManabloxPlugin[] = [];
  const visit = (plugin: ManabloxPlugin) => {
    if (done.has(plugin)) return;
    const at = path.indexOf(plugin);
    if (at >= 0) {
      throw ManabloxError.badRequest('plugin.requires.cycle', {
        plugins: [...path.slice(at), plugin].map((entry) => entry.name),
      });
    }
    path.push(plugin);
    for (const target of hard.get(plugin) ?? []) visit(target);
    path.pop();
    done.add(plugin);
  };
  for (const plugin of plugins) visit(plugin);
}
