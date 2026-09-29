import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import type { DatabaseConfig } from '@manablox/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import type { Database, DatabaseOptions, SqliteHandle } from '../client.js';
import { createSqliteDialect } from './dialect.js';
import { sqliteTables } from './tables.js';
import { serializeWrites } from './writer.js';

/** `sqlite:` is accepted as an alias of libsql's `file:`. */
const sqliteUrl = (url: string): string => url.trim().replace(/^sqlite:/i, 'file:');

/** The file a local URL points at, or `null` for a remote database. */
export function sqliteFile(url: string): string | null {
  const normalized = sqliteUrl(url);
  if (!/^file:/i.test(normalized)) return null;
  const path = normalized.replace(/\?.*$/, '');
  if (/^file:\/\//i.test(path)) return fileURLToPath(path);
  return path.slice('file:'.length);
}

export async function createSqliteDatabase(
  config: DatabaseConfig,
  options: DatabaseOptions = {},
): Promise<SqliteHandle> {
  const url = sqliteUrl(config.url);
  const file = sqliteFile(url);
  if (file && file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

  const client = serializeWrites(
    createClient({
      url,
      ...(config.authToken ? { authToken: config.authToken } : {}),
      // A transaction holds one connection; reads need another.
      ...(config.max ? { concurrency: Math.max(2, config.max) } : {}),
      timeout: 0,
    }),
  );

  // WAL lets readers run beside the writer; the mode is stored in the file.
  if (file) await client.execute('pragma journal_mode = wal');

  const db = drizzle(client, {
    schema: sqliteTables,
    casing: 'snake_case',
    ...(options.onQuery
      ? { logger: { logQuery: (query: string) => options.onQuery?.(query) } }
      : {}),
  });

  return {
    kind: 'sqlite',
    db: db as unknown as Database,
    client,
    tables: sqliteTables,
    dialect: createSqliteDialect(),
    ping: async () => {
      await db.run(sql`select 1`);
    },
    close: async () => {
      client.close();
    },
  };
}
