import type { ParsedArgs } from '../args.js';
import type { CliPlugin } from '../plugins.js';
import type { Prompter, Reporter } from '../ui.js';

type Scaffold = (
  options: Record<string, string>,
  flags: Record<string, boolean>,
  positionals: string[],
  context: {
    cwd: string;
    prompter: Prompter | null;
    reporter?: Reporter;
    out: NodeJS.WritableStream;
    plugins?: readonly CliPlugin[];
    load?: (ids: readonly string[]) => Promise<readonly CliPlugin[]>;
    lists?: Record<string, string[]>;
  },
) => Promise<number>;

/** `manablox create [dir]`: scaffolds an instance. */
export async function createInstance(
  args: ParsedArgs,
  plugins: readonly CliPlugin[] = [],
): Promise<number> {
  const { create } = await import('../create/index.js');
  const { firstPartyPlugins } = await import('../plugins.js');
  // Features picked in the choice that are not installed yet.
  const load = (ids: readonly string[]) =>
    firstPartyPlugins(process.cwd(), {
      install: ids,
      onInstall: (specs) => process.stderr.write(`manablox: installing ${specs.join(' ')}\n`),
    });
  return runScaffold(args, 'create', 'create a new instance', create, plugins, load);
}

/** `manablox frontend [dir]`: scaffolds a delivery API frontend. */
export async function createFrontend(args: ParsedArgs): Promise<number> {
  const { createFrontend: scaffold } = await import('../frontend/index.js');
  return runScaffold(args, 'frontend', 'create a frontend', scaffold);
}

/** Logo and prompts on a terminal; a cancel writes nothing and exits 130. */
async function runScaffold(
  args: ParsedArgs,
  command: string,
  title: string,
  scaffold: Scaffold,
  plugins: readonly CliPlugin[] = [],
  load?: (ids: readonly string[]) => Promise<readonly CliPlugin[]>,
): Promise<number> {
  const { readCliVersion } = await import('../version.js');
  const { Cancelled, clackUi, logo } = await import('../ui.js');
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

  if (interactive) process.stdout.write(logo(`manablox ${readCliVersion()}  |  ${title}`));
  const ui = interactive ? clackUi() : undefined;
  ui?.intro(`manablox ${command}`);

  try {
    return await scaffold(args.options, args.flags, args.positionals, {
      cwd: process.cwd(),
      prompter: ui && !args.flags.yes ? ui : null,
      ...(ui ? { reporter: ui } : {}),
      out: process.stdout,
      plugins,
      ...(load ? { load } : {}),
      lists: args.lists,
    });
  } catch (error) {
    if (error instanceof Cancelled) {
      process.stdout.write('manablox: cancelled, nothing was written\n');
      return 130;
    }
    throw error;
  }
}
