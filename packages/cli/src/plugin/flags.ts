import type { ParsedArgs } from '../args.js';
import type { PluginContext } from './instance.js';

/**
 * `manablox plugin enable|disable <id> [--space <name>]`: writes `features.plugins.<id>` for
 * the instance or one space through the management services, as the control API does.
 */
export async function flagCommandRun(
  args: ParsedArgs,
  context: PluginContext,
  enabled: boolean,
): Promise<number> {
  const verb = enabled ? 'enable' : 'disable';
  const [id, ...rest] = args.positionals.slice(1);
  if (!id || rest.length) {
    context.err.write(
      `manablox: plugin ${verb} takes one plugin id, e.g. manablox plugin ${verb} ai\n`,
    );
    return 1;
  }
  const { bootstrap, loadConfig, requireManagement } = await import('@manablox/server');
  const { pluginId } = await import('@manablox/core');
  const { config } = await loadConfig(args.options.config, context.cwd);
  if (!(config.plugins ?? []).some((plugin) => pluginId(plugin.name) === id)) {
    context.err.write(
      `manablox: the ${id} plugin is not configured on this instance; manablox plugin install ${id} adds it\n`,
    );
    return 1;
  }
  const runtime = requireManagement(
    await bootstrap({ ...config, server: { ...config.server, mode: 'management' } }),
  );
  try {
    const machineName = args.options.space;
    let scope: { kind: 'instance' } | { kind: 'space'; id: string } = { kind: 'instance' };
    if (machineName !== undefined) {
      const space = await runtime.repos.spaces.findByMachineName(machineName);
      if (!space) {
        context.err.write(`manablox: no space with the technical name '${machineName}'\n`);
        return 1;
      }
      scope = { kind: 'space', id: space.id };
    }
    const key = `features.plugins.${id}`;
    const stored = (await runtime.controls.settings(scope))[key];
    // Keeps what else the scope says about the flag, such as a message.
    const value =
      stored && typeof stored === 'object' && !Array.isArray(stored)
        ? { ...(stored as Record<string, unknown>), enabled }
        : { enabled };
    await runtime.controls.patch(scope, { [key]: value });
    const where = machineName === undefined ? 'the instance' : `the space ${machineName}`;
    context.out.write(
      `manablox: the ${id} plugin is ${enabled ? 'on' : 'off'} for ${where} (${key})\n`,
    );
    return 0;
  } finally {
    await runtime.shutdown();
  }
}
