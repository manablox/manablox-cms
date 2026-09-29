import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

const KNOWN = new Set<string>(['pnpm', 'npm', 'yarn', 'bun']);

/** `pnpm@10.1.0` or `pnpm/10.1.0 npm/? node/v24 ...` to `pnpm`. */
function named(value: string | undefined): PackageManager | null {
  const name = value?.trim().split(/[@/ ]/)[0];
  return name && KNOWN.has(name) ? (name as PackageManager) : null;
}

/**
 * The package manager of a project: its lockfile, else the `packageManager` field of its
 * `package.json`, else the one running this command (`npm_config_user_agent`), else pnpm.
 */
export function detectPackageManager(
  dir: string,
  env: NodeJS.ProcessEnv = process.env,
): PackageManager {
  for (const [file, manager] of LOCKFILES) if (existsSync(join(dir, file))) return manager;
  const manifest = join(dir, 'package.json');
  if (existsSync(manifest)) {
    try {
      const field = (JSON.parse(readFileSync(manifest, 'utf8')) as { packageManager?: unknown })
        .packageManager;
      const found = typeof field === 'string' ? named(field) : null;
      if (found) return found;
    } catch {
      // An unreadable manifest says nothing about the manager.
    }
  }
  return named(env.npm_config_user_agent) ?? 'pnpm';
}

/**
 * The command that installs what `package.json` lists, and updates the lockfile: the CLI runs
 * tools with `CI=true`, which makes pnpm and Yarn refuse a lockfile that no longer matches.
 */
export function installCommand(
  manager: PackageManager,
): [string, string[], Record<string, string>] {
  if (manager === 'pnpm') return [manager, ['install', '--no-frozen-lockfile'], {}];
  if (manager === 'yarn')
    return [manager, ['install'], { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' }];
  return [manager, ['install'], {}];
}

/** The command that adds packages to the project and installs them. */
export function addCommand(manager: PackageManager, specs: readonly string[]): [string, string[]] {
  return [manager, [manager === 'npm' ? 'install' : 'add', ...specs]];
}

/** The command that removes packages from the project. */
export function removeCommand(
  manager: PackageManager,
  names: readonly string[],
): [string, string[]] {
  return [manager, [manager === 'npm' ? 'uninstall' : 'remove', ...names]];
}
