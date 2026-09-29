import { CLI_CORE_COMMANDS } from '@manablox/core';
import { foreignOptions, parseArgs, peekArgs } from './args.js';
import { backup } from './commands/backup.js';
import { docs } from './commands/docs.js';
import { migrate } from './commands/migrate.js';
import { migrateDb } from './commands/migrate-db.js';
import { pluginCommand } from './commands/plugin.js';
import { managePlugins } from './commands/plugins.js';
import { pushKeys } from './commands/push-keys.js';
import { createFrontend, createInstance } from './commands/scaffold.js';
import { space } from './commands/space.js';
import { start } from './commands/start.js';
import { sync } from './commands/sync.js';
import { user } from './commands/user.js';
import { type CliPlugin, FIRST_PARTY_PLUGINS, withRequired } from './plugins.js';
import { pluginUsage, type UsagePlugins, usage } from './usage.js';

/** The core's commands; no plugin may take one of these ids. */
const CORE_COMMANDS: ReadonlySet<string> = new Set(CLI_CORE_COMMANDS);

/** The first-party plugins `create` is told to include: `--features` and `--<id>`. */
function wantedFeatures(argv: string[], features: string | undefined): string[] {
  const ids = FIRST_PARTY_PLUGINS.map((plugin) => plugin.id);
  const listed =
    features === undefined
      ? []
      : features
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => ids.includes(entry));
  return withRequired([...new Set([...listed, ...ids.filter((id) => argv.includes(`--${id}`))])]);
}

/** The plugins a command needs: the first-party ones for `create`, the instance's for the rest. */
async function pluginsFor(argv: string[]): Promise<UsagePlugins> {
  const { command, config, features, help } = peekArgs(argv);
  const cwd = process.cwd();
  const { configPlugins, firstPartyPlugins, hasConfig, packagePlugins } = await import(
    './plugins.js'
  );
  // The help reads what the instance's packages declare, without loading the config.
  const described = async () => (await packagePlugins(cwd).catch(() => [])) as CliPlugin[];
  // Found here, beside the CLI or in its cache; the ones asked for are installed first, so
  // their options parse.
  const firstParty = async (install: readonly string[]): Promise<UsagePlugins> => {
    const create = await firstPartyPlugins(cwd, {
      install: [...install],
      onInstall: (specs) => process.stderr.write(`manablox: installing ${specs.join(' ')}\n`),
    });
    const missing = FIRST_PARTY_PLUGINS.filter(
      (plugin) => !create.some((entry) => entry.id === plugin.id),
    );
    return { create, missing };
  };
  if (command === 'create') return firstParty(help ? [] : wantedFeatures(argv, features));
  // `plugin install` parses the `create` options of the first-party plugins it names.
  if (command === 'plugin' && !help && foreignOptions(argv, 'plugin')) {
    return firstParty(
      withRequired(
        FIRST_PARTY_PLUGINS.map((plugin) => plugin.id).filter((id) => argv.includes(id)),
      ),
    );
  }
  if (!command || (help && command === 'space')) {
    return { ...(await firstParty([])), instance: await described() };
  }
  if (command === 'space') return { instance: await configPlugins(config, cwd) };
  if (CORE_COMMANDS.has(command)) return {};
  if (help) {
    const instance = await described();
    if (instance.some((plugin) => plugin.id === command) || !hasConfig(config, cwd)) {
      return { instance };
    }
  }
  // A plugin's command needs the config; without one it is an unknown command.
  return { instance: hasConfig(config, cwd) ? await configPlugins(config, cwd) : [] };
}

/** `manablox <command>`; commands load `manablox.config.ts` from the working directory. */
export async function main(argv: string[]): Promise<number> {
  const plugins = await pluginsFor(argv);
  const all = [...(plugins.create ?? []), ...(plugins.instance ?? [])];
  const args = parseArgs(argv, all);
  const plugin = plugins.instance?.find(
    (entry) => entry.id === args.command && Object.keys(entry.contribution.commands ?? {}).length,
  );

  if (args.help || !args.command) {
    process.stdout.write(plugin && args.help ? pluginUsage(plugin) : usage(plugins));
    return args.help ? 0 : 1;
  }

  switch (args.command) {
    case 'start':
      return start(args);
    case 'migrate':
      return migrate(args);
    case 'migrate-db':
      return migrateDb(args);
    case 'backup':
      return backup(args);
    case 'sync':
      return sync(args);
    case 'push-keys':
      return pushKeys();
    case 'docs':
      return docs(args);
    case 'space':
      return space(args, plugins.instance ?? []);
    case 'user':
      return user(args);
    case 'create':
      return createInstance(args, plugins.create ?? []);
    case 'frontend':
      return createFrontend(args);
    case 'plugin':
      return managePlugins(args);
    default:
      if (plugin) return pluginCommand(args, plugin);
      process.stderr.write(
        `manablox: unknown command '${args.command}'${plugins.instance?.length ? '' : " (a plugin's commands need the instance config)"}\n\n${usage(plugins)}`,
      );
      return 1;
  }
}
