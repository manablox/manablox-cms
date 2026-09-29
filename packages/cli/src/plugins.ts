import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CliContribution } from '@manablox/core';
import { runCommand } from './scaffold.js';
import { readCliVersion } from './version.js';

/** A plugin's CLI contribution, loaded. */
export interface CliPlugin {
  /** The plugin id: the `manablox <id>` command and `--<id>` of `manablox create`. */
  id: string;
  /** The plugin's name, for its runtime context. */
  name: string;
  contribution: CliContribution;
}

/** A first-party plugin: offered by `manablox create` and `manablox plugin install <id>`. */
export interface FirstPartyPlugin {
  /** The plugin id: `--<id>` of `manablox create`, `manablox plugin install <id>`. */
  id: string;
  /** The npm package, installed at the CLI's version. */
  package: string;
  /** Its CLI module. */
  cli: string;
  /** The name in the feature choice. */
  label: string;
  /** One line in the feature choice. */
  hint: string;
  /** Picked unless deselected; none is, so a new instance is the core alone. */
  default: boolean;
  /** Plugins it adds to when both are installed; shown as a hint. */
  enhances: readonly string[];
  /** Plugins it cannot run without; the first-party ones come along with it. */
  requires: readonly string[];
  /** The premium product it sells (`@manablox/license`); it needs a license key. */
  premium?: 'ai' | 'website';
  /** Comes with the plugins that require it; `manablox create` does not offer it on its own. */
  implied?: boolean;
}

export const FIRST_PARTY_PLUGINS: readonly FirstPartyPlugin[] = [
  {
    id: 'website',
    package: '@manablox/plugin-website',
    cli: '@manablox/plugin-website/cli',
    label: 'Designed websites',
    hint: 'Spaces designed in the admin, served by the site process',
    default: false,
    enhances: ['ai'],
    requires: ['license'],
    premium: 'website',
  },
  {
    id: 'ai',
    package: '@manablox/plugin-ai',
    cli: '@manablox/plugin-ai/cli',
    label: 'AI assistance',
    hint: 'Text, image and model generation with your own provider keys',
    default: false,
    enhances: ['workflows', 'website'],
    requires: ['license'],
    premium: 'ai',
  },
  {
    id: 'workflows',
    package: '@manablox/plugin-workflows',
    cli: '@manablox/plugin-workflows/cli',
    label: 'Workflows',
    hint: 'Automations started by content changes, schedules and incoming webhooks',
    default: false,
    enhances: ['ai'],
    requires: [],
  },
  {
    id: 'webhooks',
    package: '@manablox/plugin-webhooks',
    cli: '@manablox/plugin-webhooks/cli',
    label: 'Webhooks',
    hint: 'Calls to other systems when content changes, and endpoints they call',
    default: false,
    enhances: ['workflows'],
    requires: [],
  },
  {
    id: 'license',
    package: '@manablox/plugin-license',
    cli: '@manablox/plugin-license/cli',
    label: 'Licenses',
    hint: 'License keys for the premium plugins',
    default: false,
    enhances: [],
    requires: [],
    implied: true,
  },
];

/** The first-party plugin with this id. */
export function firstParty(id: string): FirstPartyPlugin | undefined {
  return FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === id);
}

/** The ids with every first-party plugin they require, directly or not; required ones first. */
export function withRequired(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const required of firstParty(id)?.requires ?? []) {
      if (firstParty(required)) add(required);
    }
    out.push(id);
  };
  for (const id of ids) add(id);
  return out;
}

/** The config file names `loadConfig` tries, in order. */
const CONFIG_FILES = [
  'manablox.config.ts',
  'manablox.config.mts',
  'manablox.config.js',
  'manablox.config.mjs',
];

/** A module id, absolute path or file URL, resolved from `bases` first, then from the CLI. */
function resolveModule(specifier: string, bases: readonly string[]): string | null {
  if (specifier.startsWith('file:')) return specifier;
  if (isAbsolute(specifier)) return pathToFileURL(specifier).href;
  for (const base of [...bases, dirname(fileURLToPath(import.meta.url))]) {
    try {
      return pathToFileURL(createRequire(join(base, 'package.json')).resolve(specifier)).href;
    } catch {
      // Not installed there.
    }
  }
  return null;
}

/** Imports a contribution module and checks its shape. */
export async function importContribution(
  specifier: string,
  bases: readonly string[] = [],
): Promise<CliContribution> {
  const url = resolveModule(specifier, bases);
  if (!url) throw new Error(`cannot find the CLI module ${specifier}; is its package installed?`);
  const module = (await import(url)) as { default?: unknown };
  const contribution = module.default as CliContribution | undefined;
  if (!contribution || typeof contribution !== 'object' || typeof contribution.summary !== 'string')
    throw new Error(`${specifier} must export a defineCliContribution() object as its default`);
  return contribution;
}

/** Where the CLI installs first-party plugins it cannot find, per CLI version. */
export function pluginCacheDir(version: string): string {
  const root = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(root, 'manablox', 'plugins', `cli-${version}`);
}

/** Installs the package specs with one npm run into `dir`, which then resolves their modules. */
export async function installPlugins(specs: readonly string[], dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) writeFileSync(manifest, '{ "private": true }\n');
  const { code, output } = await runCommand(
    'npm',
    ['install', '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', ...specs],
    dir,
  );
  if (code === 0) return;
  // npm's reason, e.g. `404 Not Found - GET ...` or `... reason: getaddrinfo ENOTFOUND ...`.
  const lines = output
    .split('\n')
    .map((line) => line.replace(/^npm (?:error|ERR!) ?/, '').trim())
    .filter(Boolean);
  const reason = lines.find((line) => / - |reason:/.test(line)) ?? lines[0];
  throw new Error(reason ?? `npm exited with ${code}`);
}

/** What to run instead when first-party plugins cannot be found or installed. */
function installHint(plugins: readonly FirstPartyPlugin[], version: string): string {
  const cli = `@manablox/cli@${version}`;
  const packages = plugins.map((plugin) => `${plugin.package}@${version}`);
  return [
    `${plugins.map((plugin) => `the ${plugin.id} plugin (${plugin.package})`).join(', ')} ${plugins.length > 1 ? 'are' : 'is'} not installed next to the CLI`,
    `run the CLI together with ${plugins.length > 1 ? 'them' : 'it'}: pnpm dlx --package ${cli} ${packages.map((spec) => `--package ${spec}`).join(' ')} manablox ...`,
    `(npx: npx -p ${cli} ${packages.map((spec) => `-p ${spec}`).join(' ')} manablox ...; global: npm install -g ${packages.join(' ')}),`,
    `or leave ${plugins.length > 1 ? 'them' : 'it'} out`,
  ].join('\n  ');
}

export interface FirstPartyOptions {
  /** Ids to install into the cache when they are missing, with one npm run. */
  install?: readonly string[];
  /** Told before an install starts. */
  onInstall?: (specs: readonly string[]) => void;
}

/**
 * The first-party plugins' contributions, from the working directory, the CLI's own
 * packages or the CLI's cache. Missing ones named in `install` are installed into the cache
 * first, all with one npm run; other missing ones are left out.
 */
export async function firstPartyPlugins(
  cwd: string,
  options: FirstPartyOptions = {},
  plugins: readonly FirstPartyPlugin[] = FIRST_PARTY_PLUGINS,
): Promise<CliPlugin[]> {
  const version = readCliVersion();
  const cache = pluginCacheDir(version);
  const find = (plugin: FirstPartyPlugin) => resolveModule(plugin.cli, [cwd, cache]);
  const missing = plugins.filter((plugin) => options.install?.includes(plugin.id) && !find(plugin));
  if (missing.length) {
    const specs = missing.map((plugin) => `${plugin.package}@${version}`);
    options.onInstall?.(specs);
    try {
      await installPlugins(specs, cache);
    } catch (error) {
      throw new Error(
        `installing ${specs.join(' ')} failed: ${(error as Error).message}\n  ${installHint(missing, version)}`,
      );
    }
    const still = missing.filter((plugin) => !find(plugin));
    if (still.length) throw new Error(installHint(still, version));
  }
  const loaded: CliPlugin[] = [];
  for (const plugin of plugins) {
    const url = find(plugin);
    if (!url) continue;
    loaded.push({ id: plugin.id, name: plugin.id, contribution: await importContribution(url) });
  }
  return loaded;
}

/** What a dependency declares in its `package.json`: `"manablox": { "plugin", "cli" }`. */
interface DeclaredPlugin {
  id: string;
  name: string;
  cli: string;
}

/** The plugins the dependencies of the package in `dir` declare with a CLI module. */
async function declaredPlugins(dir: string): Promise<DeclaredPlugin[]> {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return [];
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const pkg = read(manifest);
  const names = Object.keys({
    ...(pkg.dependencies as object | undefined),
    ...(pkg.devDependencies as object | undefined),
  });
  const { pluginId } = await import('@manablox/core');
  const found: DeclaredPlugin[] = [];
  for (const name of names) {
    const path = join(dir, 'node_modules', name, 'package.json');
    if (!existsSync(path)) continue;
    const declared = read(path).manablox as { plugin?: unknown; cli?: unknown } | undefined;
    if (typeof declared?.plugin !== 'string' || typeof declared.cli !== 'string') continue;
    found.push({ id: pluginId(declared.plugin), name: declared.plugin, cli: declared.cli });
  }
  return found;
}

/**
 * Contributions the instance's dependencies declare in their `package.json`
 * (`"manablox": { "plugin": "<name>", "cli": "<module id>" }`), for the help: found without
 * loading the config.
 */
export async function packagePlugins(cwd: string): Promise<CliPlugin[]> {
  const { CLI_CORE_COMMANDS } = await import('@manablox/core');
  const found: CliPlugin[] = [];
  for (const declared of await declaredPlugins(cwd)) {
    // A plugin named like a core command never runs as one; loading the config says why.
    if ((CLI_CORE_COMMANDS as readonly string[]).includes(declared.id)) continue;
    found.push({
      id: declared.id,
      name: declared.name,
      contribution: await importContribution(declared.cli, [cwd]),
    });
  }
  return found;
}

/**
 * The contributions of the plugins an instance config lists. A plugin's own `cli` names its
 * module (a local plugin without a package of its own); otherwise it is the module its package
 * declares in `package.json`, found among the dependencies next to the config. Module ids and
 * relative paths resolve from the config's folder.
 */
export async function configPlugins(
  explicit: string | undefined,
  cwd: string,
): Promise<CliPlugin[]> {
  const { loadConfig } = await import('@manablox/server');
  const { CLI_CORE_COMMANDS, pluginId } = await import('@manablox/core');
  const { config, file } = await loadConfig(explicit, cwd);
  const configured = new Map<string, { name: string; cli: string | undefined }>();
  for (const plugin of config.plugins ?? []) {
    const id = pluginId(plugin.name);
    if ((CLI_CORE_COMMANDS as readonly string[]).includes(id)) {
      throw new Error(
        `the plugin ${plugin.name} has the id '${id}', which is a manablox command; rename the plugin`,
      );
    }
    if (!configured.has(id)) configured.set(id, { name: plugin.name, cli: plugin.cli });
  }
  const base = dirname(file);
  const declared = new Map((await declaredPlugins(base)).map((entry) => [entry.id, entry]));
  const found = [...configured].flatMap(([id, plugin]) => {
    const cli = plugin.cli ?? declared.get(id)?.cli;
    return cli ? [{ id, name: plugin.name, cli }] : [];
  });
  return Promise.all(
    found.map(async (entry) => ({
      id: entry.id,
      name: entry.name,
      contribution: await importContribution(entry.cli, [base]),
    })),
  );
}

/** Whether a config file is there to load. */
export function hasConfig(explicit: string | undefined, cwd: string): boolean {
  if (explicit) return existsSync(resolve(cwd, explicit));
  return CONFIG_FILES.some((name) => existsSync(resolve(cwd, name)));
}
