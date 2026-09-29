import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { validPackageName } from '../create/options.js';
import { initGit, runCommand, type ScaffoldFile, writeFiles } from '../scaffold.js';
import { askTargetDir, type Prompter, paint, plainReporter, type Reporter } from '../ui.js';
import { readCliVersion } from '../version.js';
import { resolveModel } from './model-prompts.js';
import type { Framework, FrontendOptions } from './options.js';
import {
  defaultFrontendOptions,
  FRAMEWORK_LABELS,
  frontendOptionsFromArgs,
  modelRequestFromArgs,
} from './options.js';
import { askFramework, askMissingFrontend } from './prompts.js';
import type { Fetch } from './source.js';
import { commands, renderFrontendFiles } from './templates/index.js';

export { defaultFrontendOptions, frontendOptionsFromArgs } from './options.js';
export { renderFrontendFiles } from './templates/index.js';
export type { Framework };

export interface FrontendContext {
  cwd: string;
  /** `null` without a TTY or with `--yes`. */
  prompter: Prompter | null;
  /** Defaults to plain lines on `out`. */
  reporter?: Reporter;
  out: NodeJS.WritableStream;
  /** The running `@manablox/cli` version the project depends on. */
  cliVersion?: string;
  /** Reads the content model; defaults to the global `fetch`. */
  fetch?: Fetch;
}

/** `manablox frontend [dir]`: writes a frontend for a space, with a `/preview` route. */
export async function createFrontend(
  options: Record<string, string>,
  flags: Record<string, boolean>,
  positionals: string[],
  context: FrontendContext,
): Promise<number> {
  const reporter = context.reporter ?? plainReporter(context.out);
  const given = frontendOptionsFromArgs(options, flags, positionals, context.cwd);
  const request = modelRequestFromArgs(options);
  const cliVersion = context.cliVersion ?? readCliVersion();
  const modelContext = {
    prompter: context.prompter,
    reporter,
    fetch: context.fetch ?? globalThis.fetch,
  };
  // The model's space becomes the space id default.
  const readModel = async (sofar: FrontendOptions): Promise<Partial<FrontendOptions>> => {
    const read = await resolveModel(request, sofar.url, modelContext);
    return {
      model: read.model,
      ...(read.spaceId && given.spaceId === undefined ? { spaceId: read.spaceId } : {}),
    };
  };

  // Asked first: it decides the other defaults.
  const framework: Framework =
    given.framework ?? (context.prompter ? await askFramework(context.prompter, 'astro') : 'astro');

  let dir = given.dir;
  if (dir === undefined && context.prompter) {
    dir = await askTargetDir(context.prompter, {
      message: 'Where should the frontend be created?',
      fallback: 'my-site',
      cwd: context.cwd,
      validName: validPackageName,
    });
  }
  dir ??= resolve(context.cwd, 'my-site');

  const defaults = defaultFrontendOptions(dir, framework, cliVersion);
  let resolved: FrontendOptions;
  if (context.prompter) {
    resolved = await askMissingFrontend(
      { ...given, dir, framework },
      defaults,
      context.prompter,
      readModel,
    );
  } else {
    resolved = { ...defaults, ...given, dir, framework };
    Object.assign(resolved, await readModel(resolved));
  }

  if (existsSync(resolved.dir)) {
    const entries = readdirSync(resolved.dir);
    if (entries.length > 0 && !resolved.force) {
      throw new Error(`${resolved.dir} is not empty; pass --force to write into it anyway`);
    }
  }

  // Relative when below the working directory, absolute otherwise.
  const relativeDir = relative(context.cwd, resolved.dir);
  const shown = relativeDir.startsWith('..') ? resolved.dir : relativeDir || '.';
  const files = await reporter.spin(
    `Writing ${paint.accent(FRAMEWORK_LABELS[framework])} into ${paint.path(shown)}`,
    async () => {
      const rendered: ScaffoldFile[] = renderFrontendFiles(resolved);
      writeFiles(resolved.dir, rendered);
      return rendered;
    },
    (written) => `Wrote ${written.length} files to ${paint.path(shown)}`,
  );
  reporter.note(
    'Files',
    files.map((file) => file.path),
  );
  if (resolved.model) {
    reporter.note(
      'Components',
      resolved.model.types.map((type) => `${type.name.padEnd(24)} ${type.kind}, ${type.label}`),
    );
  }

  let installed = false;
  if (resolved.install) {
    const result = await reporter.spin(
      'Installing dependencies with pnpm',
      () => runCommand('pnpm', ['install'], resolved.dir),
      (exit) =>
        exit.code === 0 ? 'Dependencies installed' : `pnpm install exited with ${exit.code}`,
    );
    installed = result.code === 0;
    if (!installed) {
      reporter.warn(
        `pnpm install did not finish; run it yourself in ${shown}\n${result.output.trim()}`,
      );
    }
  }

  if (resolved.git && !existsSync(join(resolved.dir, '.git'))) {
    const git = await initGit(resolved.dir);
    if (git.ok) reporter.step(git.message);
    else reporter.warn(git.message);
  }

  reporter.note('Next steps', nextSteps(resolved, shown, installed));
  reporter.outro(
    `Done. The README in ${paint.path(shown)} explains every file and where the values come from.`,
  );
  return 0;
}

function nextSteps(options: FrontendOptions, shown: string, installed: boolean): string[] {
  const run = commands(options);
  const lines = [`cd ${shown}`];
  if (!installed) lines.push('pnpm install');
  lines.push(
    `# the delivery API this reads from is ${options.url}; change it in .env`,
    `${run.dev}                     # http://localhost:${options.port}`,
    'pnpm types                   # typed content, once the space has a model',
    `# set the frontend URL of the space in the admin to http://localhost:${options.port}`,
    '# so the Visual button opens /preview here',
  );
  return lines;
}
