import type { ParsedArgs } from '../args.js';
import type { CreateOptions } from '../create/options.js';
import type { PackageManager } from '../package-manager.js';
import { databaseReachable, type PluginContext } from './instance.js';

/** How the instance picks up a changed set of plugins. */
export function restartSteps(
  options: CreateOptions,
  manager: PackageManager,
  installPending: boolean,
): string[] {
  const install = installPending ? [`${manager} install`] : [];
  if (options.preset === 'docker') {
    return [
      ...install,
      './scripts/lockfile.sh        # pnpm-lock.yaml, which the image build needs',
      'docker compose up -d --build # rebuilds the image and restarts the stack; migrate runs first',
    ];
  }
  return [
    ...install,
    'restart the instance: pnpm dev restarts on its own, pnpm start needs a restart',
  ];
}

/**
 * Migrates the database after an install, when the packages are in and the database answers
 * from here. The Docker stack migrates in its own container on the next `up`. Resolves to
 * whether it migrated.
 */
export async function migrateAfterInstall(
  args: ParsedArgs,
  context: PluginContext,
  options: CreateOptions,
  state: { install: boolean; installed: boolean; manager: PackageManager },
): Promise<boolean> {
  const note = (text: string): false => {
    context.out.write(`manablox: ${text}\n`);
    return false;
  };
  if (args.flags['no-migrate']) return note('not migrating (--no-migrate); run manablox migrate');
  if (options.preset === 'docker') {
    return note('the migrate service applies the migrations on the next docker compose up');
  }
  if (!state.installed) {
    return note(
      `not migrating: the packages are not installed yet; run ${state.manager} install, then manablox migrate`,
    );
  }
  const { loadConfig } = await import('@manablox/server');
  const { migrateDatabase } = await import('@manablox/db');
  let config: Awaited<ReturnType<typeof loadConfig>>['config'];
  try {
    ({ config } = await loadConfig(args.options.config, context.cwd));
  } catch (error) {
    return note(
      `not migrating: the config does not load (${(error as Error).message}); run manablox migrate once it does`,
    );
  }
  if (!config.database || !(await databaseReachable(config.database))) {
    return note('not migrating: no database answers from here; run manablox migrate once it runs');
  }
  await migrateDatabase(config.database, {
    warn: (line) => context.err.write(`manablox: ${line}\n`),
    plugins: config.plugins ?? [],
  });
  context.out.write('manablox: migrations applied\n');
  return true;
}
