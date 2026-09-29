import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serverModeProblem } from '@manablox/core';
import type { ParsedArgs } from '../args.js';

export async function start(args: ParsedArgs): Promise<number> {
  if (args.flags.watch) return watch(args);

  // Lazy: `manablox create` runs before the server is installed.
  const { loadConfig, run } = await import('@manablox/server');
  const { config } = await loadConfig(args.options.config);
  const mode = args.options.mode;
  const problem = mode ? serverModeProblem(mode, config.plugins ?? []) : null;
  if (problem) {
    process.stderr.write(
      `manablox: --mode must be one of ${problem.known.join(', ')}, not '${mode}'\n`,
    );
    return 1;
  }
  const port = args.options.port ? Number(args.options.port) : undefined;

  await run(
    {
      ...config,
      server: {
        ...config.server,
        ...(port !== undefined && Number.isFinite(port) ? { port } : {}),
        ...(args.options.host ? { host: args.options.host } : {}),
      },
    },
    mode ? { mode } : {},
  );
  // Resolves once listening; the process stays up until a signal.
  return 0;
}

/** Reruns the command under `tsx watch`, without `--watch` so the child does not fork again. */
function watch(args: ParsedArgs): Promise<number> {
  const tsxCli = fileURLToPath(import.meta.resolve('tsx/cli'));
  // Not relative to this file, whose depth differs between `src/` and `dist/`.
  const self = process.argv[1] as string;
  const forwarded = args.raw.filter((arg) => arg !== '--watch');

  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [tsxCli, 'watch', '--clear-screen=false', self, ...forwarded],
      { stdio: 'inherit' },
    );
    child.on('exit', (code) => resolvePromise(code ?? 0));
  });
}
