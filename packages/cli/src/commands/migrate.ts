import type { ParsedArgs } from '../args.js';

export async function migrate(args: ParsedArgs): Promise<number> {
  const { loadConfig } = await import('@manablox/server');
  const { migrateDatabase } = await import('@manablox/db');
  const { config } = await loadConfig(args.options.config);
  if (!config.database?.url) {
    process.stderr.write('manablox: database.url is not set in the config\n');
    return 1;
  }
  await migrateDatabase(config.database, {
    warn: (line) => process.stderr.write(`manablox: ${line}\n`),
    plugins: config.plugins ?? [],
  });
  process.stdout.write('manablox: migrations applied\n');
  return 0;
}
