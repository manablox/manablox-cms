import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import type { ParsedArgs } from '../args.js';
import { openDatabase } from './database.js';

/** A consistent copy of a SQLite database, taken while the instance runs. */
export async function backup(args: ParsedArgs): Promise<number> {
  const target = args.positionals[0];
  if (!target) {
    process.stderr.write(
      'manablox: backup needs a file to write, e.g. manablox backup backups/cms.db\n',
    );
    return 1;
  }
  const file = resolvePath(target);
  if (existsSync(file)) {
    process.stderr.write(`manablox: ${file} exists; backup never overwrites\n`);
    return 1;
  }
  const { backupSqlite } = await import('@manablox/db');
  const handle = await openDatabase(args);
  if (!handle) return 1;
  try {
    if (handle.kind !== 'sqlite') {
      process.stderr.write(
        'manablox: backup copies SQLite databases; back Postgres up with pg_dump\n',
      );
      return 1;
    }
    mkdirSync(dirname(file), { recursive: true });
    await backupSqlite(handle, file);
    process.stdout.write(`manablox: database copied to ${file}\n`);
  } finally {
    await handle.close();
  }
  return 0;
}
