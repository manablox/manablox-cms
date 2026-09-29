import type { ParsedArgs } from '../args.js';
import type { PluginContext } from '../plugin/instance.js';

const ACTIONS = ['list', 'install', 'uninstall', 'enable', 'disable'] as const;

/** `manablox plugin <action>`: plugins of the instance in the working directory. */
export async function managePlugins(
  args: ParsedArgs,
  overrides: Partial<PluginContext> = {},
): Promise<number> {
  const action = args.positionals[0];
  const err = overrides.err ?? process.stderr;
  if (!action || !(ACTIONS as readonly string[]).includes(action)) {
    err.write(
      `manablox: ${action ? `unknown plugin action '${action}'` : 'plugin needs an action'}; one of ${ACTIONS.join(', ')}\n`,
    );
    return 1;
  }
  const { readCliVersion } = await import('../version.js');
  const { runCommand } = await import('../scaffold.js');
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const { clackUi } = await import('../ui.js');
  const context: PluginContext = {
    cwd: process.cwd(),
    // `--yes` asks nothing: install takes the defaults, uninstall needs no confirmation.
    prompter: interactive && !args.flags.yes ? clackUi() : null,
    tty: interactive,
    out: process.stdout,
    err,
    cliVersion: readCliVersion(),
    run: runCommand,
    ...overrides,
  };
  switch (action) {
    case 'list':
      return (await import('../plugin/list.js')).listCommandRun(args, context);
    case 'install':
      return (await import('../plugin/install.js')).installCommandRun(args, context);
    case 'uninstall':
      return (await import('../plugin/uninstall.js')).uninstallCommandRun(args, context);
    default:
      return (await import('../plugin/flags.js')).flagCommandRun(
        args,
        context,
        action === 'enable',
      );
  }
}
