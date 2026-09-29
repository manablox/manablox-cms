import type { ParsedArgs } from '../args.js';

/** One connection to the configured database, or `null` when the config names none. */
export async function openDatabase(args: ParsedArgs) {
  const { loadConfig } = await import('@manablox/server');
  const { createDatabase } = await import('@manablox/db');
  const { config } = await loadConfig(args.options.config);
  const url = config.database?.url;
  if (!url) {
    process.stderr.write('manablox: database.url is not set in the config\n');
    return null;
  }
  return createDatabase({
    url,
    max: 1,
    ...(config.database?.ssl ? { ssl: true } : {}),
    ...(config.database?.authToken ? { authToken: config.database.authToken } : {}),
  });
}
