import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { CliContribution, CliCreateResult, CliValues } from '@manablox/core';
import { optionValues } from '../args.js';
import { LICENSE_PLUGIN, licenseSteps, premiumProducts, premiumPrompt } from '../license.js';
import { installCommand } from '../package-manager.js';
import { type CliPlugin, FIRST_PARTY_PLUGINS, withRequired } from '../plugins.js';
import { initGit, runAttached, runCommand, writeFiles } from '../scaffold.js';
import { shellQuote } from '../space/options.js';
import { askTargetDir, type Prompter, paint, plainReporter, type Reporter } from '../ui.js';
import { PASSWORD_ENV, validPassword } from '../user/options.js';
import { readCliVersion } from '../version.js';
import type { CreateOptions, PartialOptions } from './options.js';
import {
  defaultMail,
  defaultOptions,
  finalizeOptions,
  hostFromDomain,
  optionsFromArgs,
  validPackageName,
} from './options.js';
import { askMissing } from './prompts.js';
import { adminCommand, runStartSteps, spaceCommand, startSteps } from './start.js';
import {
  adminUrl,
  cliInstance,
  type InstancePlugin,
  nginxUsesTls,
  publicApiUrl,
  renderFiles,
  type Secrets,
} from './templates.js';

export { defaultOptions, finalizeOptions, optionsFromArgs } from './options.js';
export { renderFiles } from './templates.js';

export interface CreateContext {
  cwd: string;
  /** `null` without a TTY or with `--yes`. */
  prompter: Prompter | null;
  /** Defaults to plain lines on `out`. */
  reporter?: Reporter;
  out: NodeJS.WritableStream;
  /** The running `@manablox/cli` version the project depends on. */
  cliVersion?: string;
  /** The first-party plugins' contributions found so far; none is included unless picked. */
  plugins?: readonly CliPlugin[];
  /** Loads picked plugins that `plugins` lacks, e.g. by installing them into the cache. */
  load?: (ids: readonly string[]) => Promise<readonly CliPlugin[]>;
  /** Repeatable options, for plugin options of the `list` type. */
  lists?: Record<string, string[]>;
}

/** A first-party plugin as `create` sees it. */
export interface CreatePlugin {
  id: string;
  contribution: CliContribution;
  values: CliValues;
}

/** An included plugin with what it made of its options. */
export interface AppliedPlugin extends CreatePlugin {
  result: CliCreateResult;
}

/** Reads and checks each plugin's options; options of a plugin left out are refused. */
export function createPlugins(
  plugins: readonly CliPlugin[],
  args: {
    options: Record<string, string>;
    flags: Record<string, boolean>;
    lists: Record<string, string[]>;
  },
  included: Record<string, boolean> | undefined,
): CreatePlugin[] {
  const created = plugins.map(({ id, contribution }) => {
    const group = contribution.options?.create;
    const values = group ? optionValues(args, group.options) : {};
    return { id, contribution, values };
  });
  refuseLeftOut(created, included, args);
  return created;
}

/** Throws for a given option of a plugin that `included` leaves out, with how to pick it. */
function refuseLeftOut(
  plugins: readonly CreatePlugin[],
  included: Record<string, boolean> | undefined,
  args: { options: Record<string, string>; flags: Record<string, boolean> },
): void {
  for (const { id, values } of plugins) {
    const [named] = Object.keys(values);
    if (!named || included?.[id] !== false) continue;
    const hint = args.flags[`no-${id}`]
      ? `drop --no-${id}`
      : args.options.features !== undefined
        ? `add ${id} to --features`
        : `pick it with --${id}`;
    throw new Error(`--${named} belongs to the ${id} plugin, which is left out; ${hint}`);
  }
}

/** Runs each included plugin's `create` options; the first space gets their arguments and address. */
async function applyPlugins(
  plugins: readonly CreatePlugin[],
  options: CreateOptions,
  prompter: Prompter | null,
): Promise<AppliedPlugin[]> {
  const applied: AppliedPlugin[] = [];
  const instance = cliInstance(options);
  for (const plugin of plugins) {
    if (!options.plugins[plugin.id]) continue;
    const group = plugin.contribution.options?.create;
    const result = group ? await group.apply({ instance, prompter }, plugin.values) : {};
    applied.push({ ...plugin, result });
  }
  options.spaceArgs = applied.flatMap((plugin) => plugin.result.spaceArgs ?? []);
  options.pluginSpaceUrl = applied.find((plugin) => plugin.result.spaceUrl)?.result.spaceUrl;
  return applied;
}

/** `manablox create [dir]`: writes a runnable instance from flags, answers and defaults. */
export async function create(
  options: Record<string, string>,
  flags: Record<string, boolean>,
  positionals: string[],
  context: CreateContext,
): Promise<number> {
  const reporter = context.reporter ?? plainReporter(context.out);
  const cliPlugins = context.plugins ?? [];
  const given = optionsFromArgs(options, flags, positionals, context.cwd);
  const args = { options, flags, lists: context.lists ?? {} };
  const plugins = createPlugins(cliPlugins, args, given.plugins);
  for (const plugin of plugins) await plugin.contribution.options?.create?.check?.(plugin.values);
  // Read from the environment so it never shows in a command line.
  const envPassword = process.env[PASSWORD_ENV];
  if (envPassword) given.adminPassword = validPassword(envPassword);
  const cliVersion = context.cliVersion ?? readCliVersion();

  let dir = given.dir;
  if (dir === undefined && context.prompter) {
    dir = await askTargetDir(context.prompter, {
      message: 'Where should the instance be created?',
      fallback: 'my-cms',
      cwd: context.cwd,
      validName: validPackageName,
    });
  }
  dir ??= resolve(context.cwd, 'my-cms');

  const defaults = defaultOptions(
    dir,
    cliVersion,
    FIRST_PARTY_PLUGINS.filter((plugin) => plugin.default).map((plugin) => plugin.id),
  );
  // Picked in the choice but not found yet: loaded before their options apply.
  const load = async (ids: readonly string[]): Promise<CreatePlugin[]> => {
    const loaded = (await context.load?.(ids)) ?? [];
    const missing = ids.filter((id) => !loaded.some((plugin) => plugin.id === id));
    if (missing.length) throw new Error(`the ${missing.join(', ')} plugin cannot be loaded`);
    return createPlugins(
      loaded.filter((plugin) => ids.includes(plugin.id)),
      args,
      undefined,
    );
  };
  const { options: resolved, applied } = await answerOptions(
    { ...given, dir },
    defaults,
    context.prompter,
    plugins,
    { load, args },
  );
  // Without a terminal or the environment variable, a random one, shown once at the end.
  const generatedPassword = resolved.admin && resolved.start && !resolved.adminPassword;
  if (generatedPassword) resolved.adminPassword = randomBytes(18).toString('base64url');

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
    `Writing ${paint.path(shown)}`,
    async () => {
      const instance = cliInstance(resolved);
      const parts: InstancePlugin[] = await Promise.all(
        applied.map(async ({ id, contribution, result }) => ({
          id,
          templates: (await contribution.templates?.({ instance, values: result.values })) ?? {},
        })),
      );
      const rendered = renderFiles(resolved, generateSecrets(), parts);
      writeFiles(resolved.dir, rendered);
      return rendered;
    },
    (written) => `Wrote ${written.length} files to ${paint.path(shown)}`,
  );
  reporter.note(
    'Files',
    files.map((file) => file.path),
  );

  let installed = false;
  if (resolved.install) {
    // A new instance is a pnpm project: its workspace file, lockfile script and image use pnpm.
    const [manager, installArgs, installEnv] = installCommand('pnpm');
    const code = await reporter.spin(
      'Installing dependencies with pnpm',
      () => runCommand(manager, installArgs, resolved.dir, installEnv),
      (exit) =>
        exit.code === 0 ? 'Dependencies installed' : `pnpm install exited with ${exit.code}`,
    );
    installed = code.code === 0;
    if (!installed) {
      reporter.warn(
        `pnpm install did not finish; run it yourself in ${shown}\n${code.output.trim()}`,
      );
    }
  }

  // Premium plugins: one license prompt for all of them, before the instance first starts,
  // which activates the key the prompt writes to `.env`.
  const premium = premiumProducts(applied.map((plugin) => plugin.id));
  const license = applied.find((plugin) => plugin.id === LICENSE_PLUGIN);
  const licenseLater =
    premium.length && !(license && context.prompter)
      ? licenseSteps(premium, 'pnpm exec manablox')
      : [];
  if (premium.length && license && context.prompter) {
    await premiumPrompt(premium, {
      cwd: resolved.dir,
      out: context.out,
      err: context.out,
      prompter: context.prompter,
      tty: context.reporter !== undefined,
      license: { id: license.id, name: license.id, contribution: license.contribution },
      ready: false,
      runtime: () => Promise.reject(new Error('the new instance does not run yet')),
    });
  }

  if (resolved.git && !existsSync(join(resolved.dir, '.git'))) {
    const git = await initGit(resolved.dir);
    if (git.ok) reporter.step(git.message);
    else reporter.warn(git.message);
  }

  let started = false;
  if (resolved.start) {
    if (installed)
      started = await runStartSteps(startSteps(resolved, resolved.dir), resolved.dir, reporter);
    else reporter.warn('Not starting the instance: the dependencies are not installed');
  }

  const pluginSteps = [
    ...applied.flatMap(({ result }) => result.nextSteps?.({ started }) ?? []),
    ...licenseLater,
  ];
  reporter.note('Next steps', nextSteps(resolved, shown, installed, started, pluginSteps));
  if (started && generatedPassword) {
    reporter.note('Administrator', [
      `email     ${resolved.adminEmail}`,
      `password  ${resolved.adminPassword}`,
      'Shown only now: sign in and change it in your profile (your name at the bottom of the sidebar).',
    ]);
  }
  const readme = `The README in ${paint.path(shown)} explains every file and the day-two commands.`;
  if (started && resolved.preset === 'local') {
    reporter.outro(`Done. ${readme} Handing over to pnpm dev; Ctrl+C stops it.`);
    return runAttached('pnpm', ['dev'], resolved.dir);
  }
  reporter.outro(`Done. ${readme}`);
  return 0;
}

/** How `answerOptions` reaches plugins that were picked but not loaded yet. */
export interface PluginLoading {
  load(ids: readonly string[]): Promise<CreatePlugin[]>;
  /** The command line, for the hint when a left out plugin's option was given. */
  args: { options: Record<string, string>; flags: Record<string, boolean> };
}

/** Fills in what the command line left open: asked with a prompter, else the defaults; the plugins apply after the first space's name. */
export async function answerOptions(
  given: PartialOptions,
  defaults: CreateOptions,
  prompter: Prompter | null,
  plugins: readonly CreatePlugin[],
  loading?: PluginLoading,
): Promise<{ options: CreateOptions; applied: AppliedPlugin[] }> {
  const included = { ...defaults.plugins, ...given.plugins };
  let applied: AppliedPlugin[] = [];
  const apply = async (current: CreateOptions) => {
    // The choice is made: options of what was left out are refused, what is missing loads.
    refuseLeftOut(plugins, current.plugins, loading?.args ?? { options: {}, flags: {} });
    // What the picked plugins require comes along, such as the license plugin.
    const picked = withRequired(Object.keys(current.plugins).filter((id) => current.plugins[id]));
    for (const id of picked) current.plugins[id] = true;
    const missing = picked.filter((id) => !plugins.some((plugin) => plugin.id === id));
    if (missing.length && !loading) {
      throw new Error(`the ${missing.join(', ')} plugin is not installed next to the CLI`);
    }
    const all =
      missing.length && loading ? [...plugins, ...(await loading.load(missing))] : plugins;
    // In catalogue order, required ones first, whatever order they loaded in.
    const order = withRequired(FIRST_PARTY_PLUGINS.map((plugin) => plugin.id));
    const rank = (id: string) => order.indexOf(id);
    applied = await applyPlugins(
      [...all].sort((a, b) => rank(a.id) - rank(b.id)),
      current,
      prompter,
    );
  };
  let answered: CreateOptions;
  if (prompter) {
    answered = await askMissing({ ...given, plugins: included }, defaults, prompter, {
      given: given.plugins ?? {},
      features: FIRST_PARTY_PLUGINS.filter((plugin) => !plugin.implied),
      apply,
    });
  } else {
    answered = {
      ...defaults,
      ...given,
      plugins: included,
      mail: given.mail ?? defaultMail(given.preset ?? defaults.preset),
    };
    await apply(answered);
  }
  return { options: finalizeOptions(answered), applied };
}

/** Fresh secrets for a new instance, and for the parts `manablox plugin install` adds. */
export function generateSecrets(): Secrets {
  // base64url needs no quoting in a connection string or `.env`.
  const secret = (bytes: number) => randomBytes(bytes).toString('base64url');
  return {
    authSecret: secret(48),
    postgresPassword: secret(24),
    databaseOwnerPassword: secret(24),
    databaseAppPassword: secret(24),
    postgresPublicPassword: secret(24),
    plugin: () => secret(32),
  };
}

/** The first space's command, ready to paste. */
function spaceLine(options: CreateOptions): string {
  return spaceCommand(options).map(shellQuote).join(' ');
}

/** The administrator's command, which asks for the password. */
function adminLine(options: CreateOptions): string {
  return adminCommand(options).map(shellQuote).join(' ');
}

/** Opening the admin: signing in, or signing up as the first account. */
function openAdmin(options: CreateOptions): string {
  return options.admin
    ? `# open ${adminUrl(options)} and sign in as ${options.adminEmail}`
    : `# open ${adminUrl(options)} and create the first account`;
}

function nextSteps(
  options: CreateOptions,
  shown: string,
  installed: boolean,
  started: boolean,
  pluginSteps: string[] = [],
): string[] {
  if (started && options.preset === 'local') {
    const lines = [openAdmin(options)];
    if (options.publicApi) {
      lines.push(
        `pnpm dev:public              # in a second terminal: the public API at ${publicApiUrl(options)}, once a space exists`,
      );
    }
    lines.push(
      ...pluginSteps,
      `pnpm services:down           # when you are done: stops ${options.database === 'sqlite' ? 'Valkey' : 'Postgres and Valkey'}`,
    );
    return lines;
  }

  const lines = [`cd ${shown}`];
  if (options.preset === 'docker') {
    if (!installed)
      lines.push('./scripts/lockfile.sh        # pnpm-lock.yaml, which the image build needs');
    if (options.proxy !== 'none') {
      const domains = [options.adminDomain, ...(options.publicApi ? [options.publicDomain] : [])]
        .map(hostFromDomain)
        .join(' and ');
      lines.push(
        `# point ${domains} at this host${options.proxy === 'caddy' ? ', or edit .env for a local trial' : ''}`,
      );
    }
    if (started) {
      lines.push('docker compose logs -f api   # follow the management API');
    } else {
      if (options.proxy === 'nginx' && nginxUsesTls(options)) {
        lines.push('./scripts/selfsigned-certs.sh   # or put a real certificate into nginx/certs/');
      }
      lines.push('docker compose build', 'docker compose up -d');
      if (options.admin) lines.push(`${adminLine(options)}   # asks for the password`);
      if (options.space) lines.push(spaceLine(options));
    }
    lines.push(openAdmin(options));
    if (options.publicApi)
      lines.push(`# the public API answers at ${publicApiUrl(options)} once a space exists`);
    lines.push(...pluginSteps);
  } else {
    if (!installed) lines.push('pnpm install');
    lines.push(
      `pnpm services:up             # ${options.database === 'sqlite' ? 'valkey' : 'postgres and valkey'}`,
      'pnpm migrate',
      ...(options.admin ? [`${adminLine(options)}   # asks for the password`] : []),
      ...(options.space ? [spaceLine(options)] : []),
      'pnpm dev',
      openAdmin(options),
    );
    if (options.publicApi) {
      lines.push(
        `pnpm dev:public              # the public API at ${publicApiUrl(options)}, once a space exists`,
      );
    }
    lines.push(...pluginSteps);
  }
  return lines;
}
