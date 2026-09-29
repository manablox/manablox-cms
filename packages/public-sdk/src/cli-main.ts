import { writeFile } from 'node:fs/promises';
import { type ParseArgsOptionsConfig, parseArgs as parseArgv } from 'node:util';
import { createClient } from './client.js';
import { generateTypes } from './codegen.js';

/**
 * `manablox-sdk types --url <instance> --out src/manablox.d.ts` writes a `.d.ts` from the
 * instance's `/v1/types`.
 */
export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help || args.command !== 'types') {
    process.stdout.write(usage());
    return args.help ? 0 : 1;
  }

  const url = args.options.url ?? process.env.MANABLOX_URL;
  if (!url) {
    process.stderr.write('manablox-sdk: --url is required (or set MANABLOX_URL)\n');
    return 1;
  }

  const client = createClient({ url, transport: 'rest' });
  const model = await client.types();
  const output = generateTypes(model, {
    ...(args.options.prefix ? { prefix: args.options.prefix } : {}),
    source: url,
  });

  if (args.options.out) {
    await writeFile(args.options.out, output, 'utf8');
    process.stderr.write(
      `manablox-sdk: wrote ${model.types.length} types to ${args.options.out}\n`,
    );
  } else {
    process.stdout.write(output);
  }

  return 0;
}

interface ParsedArgs {
  command: string | undefined;
  options: Record<string, string | undefined>;
  help: boolean;
}

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  url: { type: 'string' },
  out: { type: 'string' },
  prefix: { type: 'string' },
} as const satisfies ParseArgsOptionsConfig;

export function parseArgs(argv: string[]): ParsedArgs {
  const { values, positionals } = parseStrict(argv);
  const { help, ...given } = values;
  const options: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(given)) options[name] = value;
  return { command: positionals[0], options, help: help === true };
}

function parseStrict(argv: string[]) {
  try {
    return parseArgv({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    const option = /Unknown option '([^']+)'/.exec(message)?.[1];
    const reason = option ? `unknown option '${option}'` : message.split('\n')[0];
    throw new Error(`${reason}; see manablox-sdk --help`);
  }
}

function usage(): string {
  return `manablox-sdk types --url <instance> [--out <file>] [--prefix <Prefix>]

Generates TypeScript types for a space's content model.

  --url      Base URL of a Manablox delivery API. Defaults to $MANABLOX_URL.
  --out      File to write. Prints to stdout when omitted.
  --prefix   Prepended to each interface name, to avoid collisions.
`;
}
