import type {
  CliCommand,
  CliCommandContext,
  CliRuntime,
  CliValues,
  ManabloxConfig,
} from '@manablox/core';
import { optionValues, type ParsedArgs } from '../args.js';
import type { CliPlugin } from '../plugins.js';
import type { Prompter } from '../ui.js';

/** The command whose words start the positionals, the longest first. */
function findCommand(
  plugin: CliPlugin,
  positionals: readonly string[],
): { words: string; command: CliCommand; rest: string[] } | undefined {
  const entries = Object.entries(plugin.contribution.commands ?? {}).sort(
    ([a], [b]) => b.split(' ').length - a.split(' ').length,
  );
  for (const [words, command] of entries) {
    const parts = words.split(' ');
    if (parts.every((part, index) => positionals[index] === part)) {
      return { words, command, rest: positionals.slice(parts.length) };
    }
  }
  return undefined;
}

/** Where a plugin's command runs and how it talks. */
export interface PluginCommandSetup {
  /** The instance folder. */
  cwd: string;
  /** `--config`. */
  config?: string | undefined;
  out: { write(text: string): unknown };
  err: { write(text: string): unknown };
  /** `null` without a terminal or with `--yes`. */
  prompter: Prompter | null;
  /** Whether stdout is a terminal: spinners, and a browser for `open`. */
  tty: boolean;
  /** Boots the instance; by default the one of `config` in `cwd`, in management mode. */
  runtime?: () => Promise<{ runtime: CliRuntime; shutdown: () => Promise<void> }>;
}

type Logging = NonNullable<ManabloxConfig['logging']>;

/**
 * The config's logging with its console output on stderr: a plugin command's stdout is its
 * answer (`manablox license status --json` for scripts), and the booted instance's log is
 * not part of it. Other destinations stay as they are.
 */
export function logsOnStderr(logging: Logging | undefined): Logging {
  const adapters = logging?.adapters?.length ? logging.adapters : [{ type: 'console' }];
  return {
    ...logging,
    adapters: adapters.map((adapter) =>
      typeof adapter === 'object' && !('stream' in adapter) && adapter.type === 'console'
        ? { ...adapter, destination: 'stderr' }
        : adapter,
    ),
  };
}

/** A command's context: its arguments, the terminal, the browser, and the instance on demand. */
async function commandContext(
  plugin: CliPlugin,
  setup: PluginCommandSetup,
  input: { positionals: string[]; values: CliValues },
) {
  let shutdown: (() => Promise<void>) | undefined;
  let booting: Promise<CliRuntime> | undefined;
  const boot =
    setup.runtime ??
    (async () => {
      const { bootstrap, loadConfig, requireManagement } = await import('@manablox/server');
      const { config } = await loadConfig(setup.config, setup.cwd);
      const booted = requireManagement(
        await bootstrap({
          ...config,
          logging: logsOnStderr(config.logging),
          server: { ...config.server, mode: 'management' },
        }),
      );
      return {
        runtime: { plugin: booted.manablox.plugin(plugin.name) },
        shutdown: () => booted.shutdown(),
      };
    });
  // Boots once, however often the command asks.
  const runtime = <S>() => {
    booting ??= boot().then((booted) => {
      shutdown = booted.shutdown;
      return booted.runtime;
    });
    return booting as Promise<CliRuntime<S>>;
  };

  // Ctrl-C aborts the command only once it reads the signal; a second one ends the process.
  const controller = new AbortController();
  let listening = false;
  const interrupt = () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
  };

  const { openUrl } = await import('../open.js');
  const ui = setup.tty ? (await import('../ui.js')).clackUi() : null;
  const context: CliCommandContext = {
    positionals: input.positionals,
    values: input.values,
    out: setup.out,
    err: setup.err,
    cwd: setup.cwd,
    prompter: setup.prompter,
    get signal() {
      if (!listening) {
        listening = true;
        process.on('SIGINT', interrupt);
      }
      return controller.signal;
    },
    open: async (url, options = {}) => {
      await openUrl(url, {
        out: setup.out,
        browser: options.browser ?? true,
        environment: { tty: setup.tty },
      });
    },
    spin: async (label, work, done) => {
      if (ui) return ui.spin(label, work, done);
      setup.out.write(`${label}\n`);
      const result = await work();
      setup.out.write(`${done(result)}\n`);
      return result;
    },
    runtime,
  };
  const close = async () => {
    if (listening) process.off('SIGINT', interrupt);
    await shutdown?.();
  };
  return { context, close };
}

/**
 * Runs a plugin's command by its words, as `manablox <plugin id> <words>` would; for the CLI's
 * own flows, e.g. the license prompt after an install. Resolves to the exit code.
 */
export async function runPluginCommand(
  plugin: CliPlugin,
  argv: readonly string[],
  values: CliValues,
  setup: PluginCommandSetup,
): Promise<number> {
  const found = findCommand(plugin, argv);
  if (!found) throw new Error(`the ${plugin.id} plugin has no command '${argv.join(' ')}'`);
  const { context, close } = await commandContext(plugin, setup, {
    positionals: found.rest,
    values,
  });
  try {
    return await found.command.run(context);
  } finally {
    await close();
  }
}

/** `manablox <plugin id> <words> [args]`: runs a plugin's command against the instance. */
export async function pluginCommand(
  args: ParsedArgs,
  plugin: CliPlugin,
  overrides: Partial<PluginCommandSetup> = {},
): Promise<number> {
  const found = findCommand(plugin, args.positionals);
  if (!found) {
    const shown = args.positionals.join(' ');
    const known = Object.keys(plugin.contribution.commands ?? {}).join(', ');
    process.stderr.write(
      `manablox: ${shown ? `unknown ${plugin.id} command '${shown}'` : `${plugin.id} needs a command`}; one of ${known}\n`,
    );
    return 1;
  }
  const options = found.command.options ?? [];
  const allowed = new Set([
    'config',
    'yes',
    ...options.flatMap((option) => [option.name, `no-${option.name}`]),
  ]);
  const given = [
    ...Object.keys(args.options),
    ...Object.keys(args.flags),
    ...Object.keys(args.lists),
  ];
  const stray = given.find((name) => !allowed.has(name));
  if (stray) {
    throw new Error(
      `unknown option '--${stray}' for '${plugin.id} ${found.words}'; see manablox ${plugin.id} --help`,
    );
  }

  const tty = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const { Cancelled, clackUi } = await import('../ui.js');
  const setup: PluginCommandSetup = {
    cwd: process.cwd(),
    config: args.options.config,
    out: process.stdout,
    err: process.stderr,
    prompter: tty && !args.flags.yes ? clackUi() : null,
    tty,
    ...overrides,
  };
  const { context, close } = await commandContext(plugin, setup, {
    positionals: found.rest,
    values: optionValues(args, options),
  });
  try {
    return await found.command.run(context);
  } catch (error) {
    if (error instanceof Cancelled) {
      setup.err.write('manablox: cancelled\n');
      return 130;
    }
    throw error;
  } finally {
    await close();
  }
}
