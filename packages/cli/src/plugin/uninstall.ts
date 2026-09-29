import type { CliContribution, ManabloxPlugin } from '@manablox/core';
import type { ParsedArgs } from '../args.js';
import { generateSecrets } from '../create/index.js';
import { installCommand } from '../package-manager.js';
import { FIRST_PARTY_PLUGINS, firstParty, firstPartyPlugins } from '../plugins.js';
import { planUninstall } from './edit.js';
import {
  applyEdit,
  configuredIds,
  contributionOf,
  type InstalledPlugin,
  installedPlugins,
  instanceOf,
  type PluginContext,
  packageManagerOf,
  printManual,
} from './instance.js';
import { restartSteps } from './steps.js';

/** Who requires what: the loaded config's plugins, else what the packages declare. */
async function requirers(
  args: ParsedArgs,
  context: PluginContext,
  installed: readonly InstalledPlugin[],
): Promise<Array<{ id: string; requires: readonly string[] }>> {
  try {
    const { loadConfig } = await import('@manablox/server');
    const { pluginId } = await import('@manablox/core');
    const { config } = await loadConfig(args.options.config, context.cwd);
    return (config.plugins ?? []).map((plugin: ManabloxPlugin) => ({
      id: pluginId(plugin.name),
      requires: plugin.requires ?? [],
    }));
  } catch {
    return installed.map((plugin) => ({
      id: plugin.id,
      requires: firstParty(plugin.id)?.requires ?? plugin.requires,
    }));
  }
}

/**
 * `manablox plugin uninstall <id>...`: removes the plugin's marked parts, whole files,
 * dependency and scripts. Its data stays in the database.
 */
export async function uninstallCommandRun(
  args: ParsedArgs,
  context: PluginContext,
): Promise<number> {
  const wanted = args.positionals.slice(1);
  if (!wanted.length) {
    context.err.write('manablox: plugin uninstall needs a plugin id, e.g. ai\n');
    return 1;
  }
  const dir = context.cwd;
  const installed = await installedPlugins(dir);
  const configured = configuredIds(dir);
  // By id, or by the package that brings it.
  const targets = wanted.map((entry) => {
    const plugin = installed.find((found) => found.id === entry || found.package === entry);
    return { id: plugin?.id ?? firstParty(entry)?.id ?? entry, plugin };
  });
  const present = targets.filter(
    ({ id, plugin }) => plugin !== undefined || configured.includes(id),
  );
  for (const { id } of targets) {
    if (!present.some((target) => target.id === id)) {
      context.out.write(`manablox: the ${id} plugin is not installed\n`);
    }
  }
  if (!present.length) return 0;

  const leaving = new Set(present.map((target) => target.id));
  for (const other of await requirers(args, context, installed)) {
    if (leaving.has(other.id)) continue;
    const needed = other.requires.filter((id) => leaving.has(id));
    if (needed.length) {
      context.err.write(
        `manablox: the ${other.id} plugin requires ${needed.join(', ')}; uninstall it first, or together: manablox plugin uninstall ${[other.id, ...needed].join(' ')}\n`,
      );
      return 1;
    }
  }

  const names = present.map((target) => target.id).join(', ');
  if (!args.flags.yes) {
    if (!context.prompter) {
      context.err.write(
        `manablox: uninstalling ${names} asks for a confirmation; pass --yes without a terminal\n`,
      );
      return 1;
    }
    const sure = await context.prompter.confirm({
      message: `Uninstall ${names}? The code and config parts go; the data stays in the database.`,
      initialValue: true,
    });
    if (!sure) {
      context.out.write('manablox: nothing was uninstalled\n');
      return 0;
    }
  }

  const { options, instance } = instanceOf(context);
  const manager = packageManagerOf(context);
  const firstPartyLoaded = await firstPartyPlugins(dir);
  const nextSteps: string[] = [];
  let manual = 0;
  let changed = 0;
  for (const { id, plugin } of present) {
    const contribution: CliContribution | null =
      firstPartyLoaded.find((loaded) => loaded.id === id)?.contribution ??
      (await contributionOf(dir, plugin?.cli ?? null));
    const extra = await contribution?.uninstall?.({
      instance,
      prompter: context.prompter,
      values: {},
    });
    nextSteps.push(...(extra?.nextSteps ?? []));
    const templates = await contribution?.templates?.({ instance, values: undefined });
    const packages = [
      ...(plugin ? [plugin.package] : []),
      ...FIRST_PARTY_PLUGINS.filter((entry) => entry.id === id).map((entry) => entry.package),
    ];
    const edit = planUninstall(
      dir,
      options,
      generateSecrets(),
      id,
      templates ? { id, templates } : null,
      packages,
    );
    const touched = applyEdit(dir, edit);
    changed += touched.length;
    manual += edit.manual.length;
    printManual(context, id, edit);
    context.out.write(
      `manablox: uninstalled the ${id} plugin${touched.length ? `: ${touched.join(', ')}` : ''}\n`,
    );
    context.out.write(
      `  Its data stays: its tables and the ext.${id} values of entries remain in the database, and manablox plugin install ${id} brings them back.\n`,
    );
  }

  const install = args.flags['no-install'] !== true;
  if (install && changed) {
    const [command, commandArgs, env] = installCommand(manager);
    context.out.write(`manablox: running ${command} ${commandArgs.join(' ')}\n`);
    const result = await context.run(command, commandArgs, dir, env);
    if (result.code !== 0) {
      context.err.write(
        `manablox: ${command} ${commandArgs.join(' ')} exited with ${result.code}; run it yourself\n${result.output.trim()}\n`,
      );
    }
  }
  if (changed) {
    const steps = [...restartSteps(options, manager, !install), ...nextSteps];
    context.out.write(`\nNext steps\n${steps.map((line) => `  ${line}`).join('\n')}\n`);
  }
  return manual && args.flags.strict ? 1 : 0;
}
