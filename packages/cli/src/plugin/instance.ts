import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CliContribution, DatabaseConfig } from '@manablox/core';
import { cliInstance } from '../create/templates.js';
import { readInstance } from '../instance.js';
import { detectPackageManager, type PackageManager } from '../package-manager.js';
import { FIRST_PARTY_PLUGINS, importContribution } from '../plugins.js';
import { regionIds } from '../regions.js';
import { type ScaffoldFile, writeFiles } from '../scaffold.js';
import type { Prompter } from '../ui.js';
import type { PluginEdit } from './edit.js';

/** Where `manablox plugin` works and how it talks. */
export interface PluginContext {
  /** The instance folder. */
  cwd: string;
  /** `null` without a terminal; install then takes the defaults, uninstall needs `--yes`. */
  prompter: Prompter | null;
  /** Whether stdout is a terminal: spinners, and a browser for the license purchase. */
  tty: boolean;
  out: { write(text: string): unknown };
  err: { write(text: string): unknown };
  cliVersion: string;
  /** Runs a tool quietly; the package manager and nothing else. */
  run: (
    command: string,
    args: string[],
    cwd: string,
    env?: Record<string, string>,
  ) => Promise<{ code: number; output: string }>;
}

/** The plugins file `manablox create` writes; `manablox plugin` edits its marked parts. */
export const PLUGINS_FILE = 'manablox.plugins.ts';

/** A dependency of the instance that declares itself a plugin. */
export interface InstalledPlugin {
  id: string;
  /** The plugin's name, e.g. `@acme/seo`. */
  name: string;
  package: string;
  /** The `package.json` range. */
  range: string;
  /** Its CLI module, when it has one. */
  cli: string | null;
  /** Plugin ids it cannot run without. */
  requires: string[];
}

/** The `"manablox"` field of a plugin package. */
interface ManabloxField {
  plugin?: unknown;
  cli?: unknown;
  requires?: unknown;
}

export interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  manablox?: ManabloxField;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** The instance's `package.json`; throws outside an instance. */
export function instanceManifest(dir: string): Manifest {
  const manifest = readJson<Manifest>(join(dir, 'package.json'));
  if (!manifest) {
    throw new Error(`no package.json in ${dir}; run manablox plugin in the folder of an instance`);
  }
  return manifest;
}

/** The plugin a package declares, read from `node_modules`; `null` when it declares none. */
export function declaredPlugin(
  dir: string,
  name: string,
  range: string,
  pluginId: (name: string) => string,
): InstalledPlugin | null {
  const manifest = readJson<Manifest>(join(dir, 'node_modules', name, 'package.json'));
  const field = manifest?.manablox;
  if (typeof field?.plugin !== 'string') return null;
  return {
    id: pluginId(field.plugin),
    name: field.plugin,
    package: name,
    range,
    cli: typeof field.cli === 'string' ? field.cli : null,
    requires: Array.isArray(field.requires)
      ? field.requires.filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

/**
 * The instance's plugin dependencies: first-party ones by their package name, even before
 * they are installed, others by the `manablox` field in `node_modules`.
 */
export async function installedPlugins(dir: string): Promise<InstalledPlugin[]> {
  const { pluginId } = await import('@manablox/core');
  const manifest = instanceManifest(dir);
  const deps = { ...manifest.devDependencies, ...manifest.dependencies };
  const out: InstalledPlugin[] = [];
  for (const [name, range] of Object.entries(deps)) {
    const known = FIRST_PARTY_PLUGINS.find((plugin) => plugin.package === name);
    if (known) {
      out.push({
        id: known.id,
        name: known.id,
        package: name,
        range,
        cli: known.cli,
        requires: [...known.requires],
      });
      continue;
    }
    const declared = declaredPlugin(dir, name, range, pluginId);
    if (declared) out.push(declared);
  }
  return out;
}

/** The plugin ids with a part in the plugins file. */
export function configuredIds(dir: string): string[] {
  const path = join(dir, PLUGINS_FILE);
  if (!existsSync(path)) return [];
  try {
    return regionIds(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
}

/** The instance as a plugin's `install` and `templates` see it. */
export function instanceOf(context: PluginContext) {
  const options = readInstance(context.cwd, context.cliVersion);
  return { options, instance: { ...cliInstance(options), space: null } };
}

export function packageManagerOf(context: PluginContext): PackageManager {
  return detectPackageManager(context.cwd);
}

/** A contribution from the instance, else `null`. */
export async function contributionOf(
  dir: string,
  cli: string | null,
): Promise<CliContribution | null> {
  if (!cli) return null;
  try {
    return await importContribution(cli, [dir]);
  } catch {
    return null;
  }
}

/** Writes and deletes what an edit says; returns the paths it touched. */
export function applyEdit(dir: string, edit: PluginEdit): string[] {
  const writes: ScaffoldFile[] = [...edit.writes.values()];
  writeFiles(dir, writes);
  for (const path of edit.deletes) rmSync(join(dir, ...path.split('/')), { force: true });
  return [...writes.map((file) => file.path), ...edit.deletes];
}

/** Prints the parts that could not be placed, each with its file and anchor. */
export function printManual(context: PluginContext, id: string, edit: PluginEdit): void {
  for (const part of edit.manual) {
    context.err.write(`manablox: ${part.reason}; nothing was written to ${part.path}\n`);
    if (!part.text) continue;
    const where = part.slot ? ` after the line 'manablox:slot ${part.slot}'` : '';
    context.err.write(`  the ${id} part for ${part.path}${where}:\n`);
    for (const line of part.text.replace(/\n$/, '').split('\n')) context.err.write(`    ${line}\n`);
  }
}

/** Resolves when the database answers within `ms`; `false` for anything else. */
export async function databaseReachable(database: DatabaseConfig | undefined, ms = 3000) {
  if (!database?.url) return false;
  const { createDatabase } = await import('@manablox/db');
  let handle: Awaited<ReturnType<typeof createDatabase>> | undefined;
  try {
    handle = await createDatabase({ ...database, max: 1 });
    const ping = handle.ping().then(
      () => true,
      () => false,
    );
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), ms).unref();
    });
    return await Promise.race([ping, timeout]);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}
