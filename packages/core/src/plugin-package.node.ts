import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginDatabase } from './plugin.js';

/** Where a plugin package keeps its migrations and admin bundle. */
export interface PluginPackage {
  /** The folder holding the package's `package.json`. */
  root: string;
  /** `migrations` and `migrations-sqlite`, for `db.migrations`. */
  migrations: PluginDatabase['migrations'];
  /** `dist/admin`, for `admin.dir`. */
  adminDir: string;
}

/**
 * The folders of the plugin package a module belongs to, from its `import.meta.url`: found
 * from the sources and from the build alike.
 */
export function pluginPackage(moduleUrl: string): PluginPackage {
  let root = dirname(fileURLToPath(moduleUrl));
  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root);
  return {
    root,
    migrations: { postgres: join(root, 'migrations'), sqlite: join(root, 'migrations-sqlite') },
    adminDir: join(root, 'dist', 'admin'),
  };
}
