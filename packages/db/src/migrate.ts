import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type DatabaseConfig, type ManabloxPlugin, pluginId } from '@manablox/core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { applyBootstrapSql } from './bootstrap.js';
import { createDatabase, type DatabaseHandle, dialectOf } from './client.js';
import { assertAppRole, grantAppRole, roleOf } from './roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The Postgres migrations shipped with this package. */
export const MIGRATIONS_FOLDER = resolve(root, 'migrations');

/** The SQLite migrations shipped with this package. */
export const SQLITE_MIGRATIONS_FOLDER = resolve(root, 'migrations-sqlite');

/** Drizzle's journal of the core migrations. */
const CORE_JOURNAL = '__drizzle_migrations';

/** The Postgres schema holding every journal. */
const JOURNAL_SCHEMA = 'drizzle';

async function migrateFolder(
  handle: DatabaseHandle,
  folder: string,
  journal = CORE_JOURNAL,
): Promise<void> {
  const config = { migrationsFolder: folder, migrationsTable: journal };
  if (handle.kind === 'sqlite') {
    const { migrate: migrateSqlite } = await import('drizzle-orm/libsql/migrator');
    await migrateSqlite(handle.db as never, config);
    return;
  }
  await migrate(handle.db, { ...config, migrationsSchema: JOURNAL_SCHEMA });
}

/** A plugin with tables, as the migrator sees it. */
export interface PluginMigrations {
  id: string;
  journal: string;
  folder: string;
}

/**
 * The plugins that own tables, first of a name only, with their journal and the folder for
 * `dialect`; refuses two names with one id.
 */
export function pluginMigrations(
  plugins: readonly ManabloxPlugin[],
  dialect: DatabaseHandle['kind'],
): PluginMigrations[] {
  const out: PluginMigrations[] = [];
  const names = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.db || names.has(plugin.name)) continue;
    names.add(plugin.name);
    const id = pluginId(plugin.name);
    if (out.some((entry) => entry.id === id)) {
      throw new Error(`two plugins with tables share the id "${id}"`);
    }
    const folder = plugin.db.migrations[dialect];
    if (!folder) throw new Error(`plugin "${id}" has no ${dialect} migrations`);
    out.push({ id, journal: `__manablox_migrations_${id}`, folder });
  }
  return out;
}

/** Migrates the tables of `plugins`, each with its own journal. Idempotent. */
export async function runPluginMigrations(
  handle: DatabaseHandle,
  plugins: readonly ManabloxPlugin[],
): Promise<void> {
  for (const entry of pluginMigrations(plugins, handle.kind)) {
    await migrateFolder(handle, entry.folder, entry.journal);
  }
}

/** Migrates a database to this package's schema, then the tables of `plugins`. Idempotent. */
export async function runMigrations(
  handle: DatabaseHandle,
  plugins: readonly ManabloxPlugin[] = [],
): Promise<void> {
  // Extensions must exist before migrations reference ltree columns.
  if (handle.kind === 'postgres') await applyBootstrapSql(handle.sql);
  const folder = handle.kind === 'sqlite' ? SQLITE_MIGRATIONS_FOLDER : MIGRATIONS_FOLDER;
  await migrateFolder(handle, folder);
  await runPluginMigrations(handle, plugins);
}

export interface MigrateDatabaseOptions {
  /** Notes such as an ignored migration URL. */
  warn?: (line: string) => void;
  /** Resolved plugins whose tables to migrate after core's. */
  plugins?: readonly ManabloxPlugin[];
}

/**
 * Migrates the database `config` names. With `migrationUrl` on Postgres the migrations run as
 * that owner role, which then grants the role of `url` its privileges; SQLite ignores it.
 */
export async function migrateDatabase(
  config: DatabaseConfig,
  options: MigrateDatabaseOptions = {},
): Promise<void> {
  const postgres = dialectOf(config.url) === 'postgres';
  if (!postgres && config.migrationUrl) {
    options.warn?.('MIGRATION_DATABASE_URL is ignored on SQLite');
  }
  const owner = postgres && config.migrationUrl ? config.migrationUrl : null;
  const handle = await createDatabase({ ...config, url: owner ?? config.url, max: 1 });
  try {
    // Refused before anything is migrated.
    const appRole = owner && handle.kind === 'postgres' ? await roleOf(config) : null;
    if (appRole && handle.kind === 'postgres') await assertAppRole(handle.sql, appRole);
    await runMigrations(handle, options.plugins);
    if (appRole && handle.kind === 'postgres') await grantAppRole(handle.sql, appRole);
  } finally {
    await handle.close();
  }
}

/** Shipped and applied migrations; `applied` is the newest one recorded, `null` when none. */
export interface MigrationStatus {
  latest: string | null;
  applied: string | null;
  pending: number;
  /** The same per plugin with tables. */
  plugins: PluginMigrationStatus[];
}

export interface PluginMigrationStatus {
  /** The plugin's id, see `pluginId`. */
  id: string;
  latest: string | null;
  applied: string | null;
  pending: number;
}

/** When the newest migration recorded in `journal` was made; `null` when none or no journal. */
async function newestApplied(handle: DatabaseHandle, journal: string): Promise<number | null> {
  if (handle.kind === 'sqlite') {
    const { rows: found } = await handle.client.execute({
      sql: "select 1 from sqlite_master where type = 'table' and name = ?",
      args: [journal],
    });
    if (found.length === 0) return null;
    const { rows } = await handle.client.execute(
      `select max(created_at) as newest from ${quoteIdent(journal)}`,
    );
    const value = rows[0]?.newest;
    return value === null || value === undefined ? null : Number(value);
  }
  const [found] = await handle.sql<{ exists: boolean }[]>`
    select exists (select 1 from information_schema.tables
      where table_schema = ${JOURNAL_SCHEMA} and table_name = ${journal}) as exists`;
  if (!found?.exists) return null;
  const [row] = await handle.sql.unsafe<{ newest: string | null }[]>(
    `select max(created_at)::text as newest from ${quoteIdent(JOURNAL_SCHEMA)}.${quoteIdent(journal)}`,
  );
  return row?.newest ? Number(row.newest) : null;
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function folderStatus(
  handle: DatabaseHandle,
  folder: string,
  journal: string,
): Promise<Omit<MigrationStatus, 'plugins'>> {
  const { entries } = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const newest = await newestApplied(handle, journal);
  const applied = newest === null ? [] : entries.filter((entry) => entry.when <= newest);
  return {
    latest: entries.at(-1)?.tag ?? null,
    applied: applied.at(-1)?.tag ?? null,
    pending: entries.length - applied.length,
  };
}

/** Compares the shipped journals of core and `plugins` with what the database recorded. */
export async function migrationStatus(
  handle: DatabaseHandle,
  plugins: readonly ManabloxPlugin[] = [],
): Promise<MigrationStatus> {
  const folder = handle.kind === 'sqlite' ? SQLITE_MIGRATIONS_FOLDER : MIGRATIONS_FOLDER;
  const core = await folderStatus(handle, folder, CORE_JOURNAL);
  const out: PluginMigrationStatus[] = [];
  for (const entry of pluginMigrations(plugins, handle.kind)) {
    out.push({ id: entry.id, ...(await folderStatus(handle, entry.folder, entry.journal)) });
  }
  return { ...core, plugins: out };
}
