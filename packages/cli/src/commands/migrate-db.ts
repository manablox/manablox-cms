import type { ParsedArgs } from '../args.js';

/** Copies the configured SQLite database into Postgres; exit 2 when verification fails. */
export async function migrateDb(args: ParsedArgs): Promise<number> {
  const target = args.options.to;
  if (!target) {
    process.stderr.write(
      'manablox: migrate-db needs the Postgres database, e.g. manablox migrate-db --to postgres://user:pass@host:5432/manablox\n',
    );
    return 1;
  }
  const { loadConfig } = await import('@manablox/server');
  const { MigrateDbRefused, migrateSqliteToPostgres, redactUrl } = await import('@manablox/db');
  const { config } = await loadConfig(args.options.config);
  const url = config.database?.url;
  if (!url) {
    process.stderr.write('manablox: database.url is not set in the config\n');
    return 1;
  }

  const out = (line: string) => process.stdout.write(`manablox: ${line}\n`);
  let report: Awaited<ReturnType<typeof migrateSqliteToPostgres>>;
  try {
    report = await migrateSqliteToPostgres({
      source: {
        url,
        ...(config.database?.authToken ? { authToken: config.database.authToken } : {}),
      },
      target,
      ...(args.options['app-role'] ? { appRole: args.options['app-role'] } : {}),
      replace: args.flags.replace === true,
      forceOffline: args.flags['force-offline'] === true,
      plugins: config.plugins ?? [],
      log: out,
    });
  } catch (error) {
    if (error instanceof MigrateDbRefused) {
      process.stderr.write(`manablox: ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const rows = report.tables.reduce((sum, table) => sum + table.target, 0);
  if (!report.ok) {
    process.stderr.write(`manablox: verification failed:\n`);
    for (const line of report.mismatches) process.stderr.write(`  ${line}\n`);
    return 2;
  }
  out(
    `verified ${report.tables.length} tables, ${rows} rows, ${report.audit.target.checked} audit entries, ${report.sampled} rows compared field by field`,
  );
  process.stdout.write(
    [
      '',
      'Next steps:',
      '  1. Stop the instance if it still runs.',
      '  2. Point the instance at Postgres and drop the SQLite settings:',
      `       DATABASE_URL=${redactUrl(target)}`,
      '     and remove DATABASE_AUTH_TOKEN if it is set. With a separate app role, set',
      '     MIGRATION_DATABASE_URL to this URL and DATABASE_URL to the app role.',
      '  3. Start the instance: manablox start',
      '  4. If you set the instance read-only, lift it:',
      '       PUT /control/v1/instance/state {"status":"active"}',
      '  5. Keep the SQLite file until the instance runs well on Postgres.',
      '',
    ].join('\n'),
  );
  return 0;
}
