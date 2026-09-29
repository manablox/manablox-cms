import { ManabloxError } from './errors.js';
import type { ManabloxPlugin, PluginServerMode } from './plugin.js';
import { CORE_SERVER_MODES } from './server-config.js';

/** Why a mode name cannot run: no core mode or plugin mode goes by it. */
export interface ServerModeProblem {
  key: 'config.mode.unknown';
  mode: string;
  known: string[];
}

/** The plugins' modes by name; a name taken twice, or by a core mode, fails. */
export function pluginServerModes(
  plugins: readonly ManabloxPlugin[],
): Map<string, { plugin: ManabloxPlugin; mode: PluginServerMode }> {
  const out = new Map<string, { plugin: ManabloxPlugin; mode: PluginServerMode }>();
  for (const plugin of plugins) {
    for (const mode of plugin.modes ?? []) {
      const taken = (CORE_SERVER_MODES as readonly string[]).includes(mode.name)
        ? 'core'
        : out.get(mode.name)?.plugin.name;
      if (taken !== undefined) {
        throw ManabloxError.conflict('plugin.key.duplicate', {
          kind: 'mode',
          key: mode.name,
          plugins: [taken, plugin.name],
        });
      }
      out.set(mode.name, { plugin, mode });
    }
  }
  return out;
}

/** `null` when `mode` is a core mode or one of the plugins'. */
export function serverModeProblem(
  mode: string,
  plugins: readonly ManabloxPlugin[],
): ServerModeProblem | null {
  if ((CORE_SERVER_MODES as readonly string[]).includes(mode)) return null;
  const modes = pluginServerModes(plugins);
  if (modes.has(mode)) return null;
  return { key: 'config.mode.unknown', mode, known: [...CORE_SERVER_MODES, ...modes.keys()] };
}
