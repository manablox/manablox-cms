import type { ManabloxConfig } from '@manablox/core';
import type { ParsedArgs } from '../args.js';
import { LICENSE_PLUGIN, licenseStates, type PremiumProduct } from '../license.js';
import { FIRST_PARTY_PLUGINS, firstPartyPlugins } from '../plugins.js';
import {
  configuredIds,
  databaseReachable,
  type InstalledPlugin,
  installedPlugins,
  instanceManifest,
  type Manifest,
  type PluginContext,
} from './instance.js';

interface Row {
  id: string;
  package: string;
  installed: boolean;
  configured: boolean;
  migrations: string;
  flag: string;
  /** The premium product it sells, `-` for none. */
  premium: string;
  /** Its product's license state, `-` for a plugin that is not premium or not configured. */
  license: string;
}

/** What the database says per plugin id; empty maps and a reason without one. */
async function databaseState(
  config: ManabloxConfig,
): Promise<{ migrations: Map<string, string>; flags: Map<string, string>; reason?: string }> {
  const migrations = new Map<string, string>();
  const flags = new Map<string, string>();
  if (!config.database || !(await databaseReachable(config.database))) {
    return { migrations, flags, reason: 'no database answers from here' };
  }
  const { createDatabase, migrationStatus, ControlSettingRepository } = await import(
    '@manablox/db'
  );
  const { pluginId } = await import('@manablox/core');
  const handle = await createDatabase({ ...config.database, max: 1 });
  try {
    const status = await migrationStatus(handle, config.plugins ?? []);
    for (const plugin of status.plugins) {
      migrations.set(plugin.id, plugin.pending ? `${plugin.pending} pending` : 'up to date');
    }
    const rows = await new ControlSettingRepository(handle).listByScope({ kind: 'instance' });
    for (const plugin of config.plugins ?? []) {
      const id = pluginId(plugin.name);
      const stored = rows.find((row) => row.key === `features.plugins.${id}`)?.value as
        | { enabled?: unknown }
        | undefined;
      flags.set(id, stored?.enabled === false ? 'off' : stored ? 'on' : 'on (default)');
    }
  } finally {
    await handle.close();
  }
  return { migrations, flags };
}

/**
 * The configured plugins `plugin list` shows: all but library plugins, a dependency of the
 * instance without a `manablox` package field such as `@manablox/fields`, which only adds
 * field types and is not a feature to install or switch. A plugin defined in the instance's
 * own code is no dependency and stays.
 */
export function listedConfigured(
  plugins: readonly { name: string }[],
  manifest: Manifest,
  installed: readonly InstalledPlugin[],
  pluginId: (name: string) => string,
): string[] {
  const deps = { ...manifest.devDependencies, ...manifest.dependencies };
  const ids = plugins
    .filter(
      (plugin) =>
        !(plugin.name in deps) || installed.some((entry) => entry.package === plugin.name),
    )
    .map((plugin) => pluginId(plugin.name));
  return [...new Set(ids)];
}

/**
 * `manablox plugin list`: the first-party plugins, the installed and configured ones, and,
 * with a database, their migrations and instance flags.
 */
export async function listCommandRun(args: ParsedArgs, context: PluginContext): Promise<number> {
  const dir = context.cwd;
  const installed = await installedPlugins(dir);
  let configured = configuredIds(dir);
  let licenses: Map<PremiumProduct, string> | null = null;
  let state: Awaited<ReturnType<typeof databaseState>> = {
    migrations: new Map(),
    flags: new Map(),
    reason: 'the config does not load',
  };
  try {
    const { loadConfig } = await import('@manablox/server');
    const { pluginId } = await import('@manablox/core');
    const { config } = await loadConfig(args.options.config, dir);
    configured = listedConfigured(config.plugins ?? [], instanceManifest(dir), installed, pluginId);
    state = await databaseState(config).catch((error: unknown) => ({
      migrations: new Map(),
      flags: new Map(),
      reason: `the database could not be read (${(error as Error).message})`,
    }));
    if (!state.reason && state.migrations.get(LICENSE_PLUGIN) === 'up to date') {
      licenses = await instanceLicenses(dir, args.options.config, context);
    }
  } catch (error) {
    state.reason = `the config does not load (${(error as Error).message.split('\n')[0]})`;
  }

  const ids = [
    ...FIRST_PARTY_PLUGINS.map((plugin) => plugin.id),
    ...installed.map((plugin) => plugin.id),
    ...configured,
  ].filter((id, index, all) => all.indexOf(id) === index);
  const rows: Row[] = ids.map((id) => {
    const found = installed.find((plugin) => plugin.id === id);
    const known = FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === id);
    return {
      id,
      package: found?.package ?? known?.package ?? '',
      installed: Boolean(found),
      configured: configured.includes(id),
      migrations: state.migrations.get(id) ?? (state.reason ? '?' : '-'),
      flag: state.flags.get(id) ?? (state.reason ? '?' : '-'),
      premium: known?.premium ?? '-',
      license:
        known?.premium && configured.includes(id) ? (licenses?.get(known.premium) ?? '?') : '-',
    };
  });
  const table = [
    [
      'plugin',
      'package',
      'installed',
      'configured',
      'migrations',
      'instance flag',
      'premium',
      'license',
    ],
    ...rows.map((row) => [
      row.id,
      row.package,
      row.installed ? 'yes' : 'no',
      row.configured ? 'yes' : 'no',
      row.migrations,
      row.flag,
      row.premium,
      row.license,
    ]),
  ];
  const widths =
    table[0]?.map((_, column) => Math.max(...table.map((line) => line[column]?.length ?? 0))) ?? [];
  for (const line of table) {
    context.out.write(
      `${line
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd()}\n`,
    );
  }
  const available = FIRST_PARTY_PLUGINS.filter(
    (plugin) => !installed.some((entry) => entry.id === plugin.id),
  );
  if (available.length) {
    context.out.write('\nAvailable: manablox plugin install <id>\n');
    for (const plugin of available) {
      context.out.write(`  ${plugin.id.padEnd(10)} ${plugin.label}: ${plugin.hint}\n`);
    }
  }
  if (state.reason) {
    context.out.write(`\nMigrations and flags are unknown: ${state.reason}.\n`);
  }
  if (rows.some((row) => row.license !== '-')) {
    context.out.write('\nLicenses: manablox license status; buy one with manablox license buy\n');
  }
  return 0;
}

/** The license state of each premium product, from the license plugin; `null` when unknown. */
async function instanceLicenses(
  dir: string,
  config: string | undefined,
  context: PluginContext,
): Promise<Map<PremiumProduct, string> | null> {
  const license = (await firstPartyPlugins(dir)).find((plugin) => plugin.id === LICENSE_PLUGIN);
  if (!license) return null;
  return licenseStates({
    cwd: dir,
    config,
    out: context.out,
    err: context.err,
    prompter: null,
    tty: false,
    license,
    ready: true,
  });
}
