import type { SqliteHandle } from './client.js';

/** Writes a consistent copy of a SQLite database to `file` while it stays in use. */
export async function backupSqlite(handle: SqliteHandle, file: string): Promise<void> {
  await handle.client.execute({ sql: 'vacuum into ?', args: [file] });
}
