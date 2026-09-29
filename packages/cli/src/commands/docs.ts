import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ParsedArgs } from '../args.js';

/**
 * `manablox docs generate --out <dir>`: the reference pages derived from the code, for the
 * instance of the config (its plugins' error keys and procedures included). Loads the
 * config without booting it, so no database is needed.
 */
export async function docs(args: ParsedArgs): Promise<number> {
  const [sub] = args.positionals;
  if (sub !== 'generate') {
    process.stderr.write(
      `manablox: ${sub ? `unknown docs command '${sub}'` : 'docs needs a command'}; try manablox docs generate --out <dir>\n`,
    );
    return 1;
  }
  const out = args.options.out;
  if (!out) {
    process.stderr.write('manablox: docs generate needs --out <dir>\n');
    return 1;
  }
  const { loadConfig } = await import('@manablox/server');
  const { orderPlugins } = await import('@manablox/core');
  const { referencePages } = await import('../docs/pages.js');
  const { config } = await loadConfig(args.options.config);
  // Refuses a plugin graph the instance would refuse to boot with.
  orderPlugins(config.plugins ?? []);
  const pages = await referencePages(config.plugins ?? []);
  for (const [file, text] of Object.entries(pages)) {
    const target = resolve(out, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    process.stdout.write(`manablox: wrote ${target}\n`);
  }
  return 0;
}
