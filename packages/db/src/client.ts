import type { Client } from '@libsql/client';
import { type DatabaseConfig, type DatabaseDialect, databaseDialect } from '@manablox/core';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Dialect } from './dialect.js';
import { postgresDialect } from './postgres/dialect.js';
import * as schema from './schema/index.js';
import { postgresTables, type Tables } from './tables.js';

/** Typed as Postgres; every driver answers the query-builder calls repositories make. */
export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** A database or a transaction. */
export type Executor = Database | Transaction;
export type Sql = ReturnType<typeof postgres>;

interface HandleBase {
  db: Database;
  tables: Tables;
  dialect: Dialect;
  /** Throws when the database cannot be reached. */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export interface PostgresHandle extends HandleBase {
  kind: 'postgres';
  sql: Sql;
}

export interface SqliteHandle extends HandleBase {
  kind: 'sqlite';
  client: Client;
}

export type DatabaseHandle = PostgresHandle | SqliteHandle;

export interface DatabaseOptions {
  /** Called once per statement sent to the database. */
  onQuery?: (query: string) => void;
}

/** The dialect of a database URL; throws for an unsupported scheme. */
export function dialectOf(url: string): DatabaseDialect {
  const dialect = databaseDialect(url);
  if (!dialect) throw new Error(`Unsupported database URL scheme: ${url.split(':')[0]}`);
  return dialect;
}

/** Connects to the database `config.url` names. */
export async function createDatabase(
  config: DatabaseConfig,
  options: DatabaseOptions = {},
): Promise<DatabaseHandle> {
  if (dialectOf(config.url) === 'sqlite') {
    const { createSqliteDatabase } = await import('./sqlite/client.js');
    return createSqliteDatabase(config, options);
  }
  return createPostgresDatabase(config, options);
}

export function createPostgresDatabase(
  config: DatabaseConfig,
  options: DatabaseOptions = {},
): PostgresHandle {
  const client = postgres(config.url, {
    max: config.max ?? 10,
    ...(options.onQuery ? { debug: (_c: number, query: string) => options.onQuery?.(query) } : {}),
    ...(config.ssl ? { ssl: 'require' as const } : {}),
    // No `types: {}`: it replaces the built-in serialisers and breaks Date parameters.
    onnotice: () => {},
  });

  const db = drizzle(client, { schema, casing: 'snake_case' });

  return {
    kind: 'postgres',
    db,
    sql: client,
    tables: postgresTables,
    dialect: postgresDialect,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.end({ timeout: 5 }),
  };
}
