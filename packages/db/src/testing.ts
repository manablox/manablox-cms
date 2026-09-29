import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatabaseDialect, ManabloxPlugin } from '@manablox/core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { applyBootstrapSql } from './bootstrap.js';
import { createDatabase, createPostgresDatabase } from './client.js';
import {
  MIGRATIONS_FOLDER,
  pluginMigrations,
  runMigrations,
  runPluginMigrations,
  SQLITE_MIGRATIONS_FOLDER,
} from './migrate.js';

/** Used only to create per-suite databases, so falling back to `DATABASE_URL` is safe. */
const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://manablox:manablox@localhost:5432/manablox';

/** `sqlite` runs every suite on a temporary SQLite file instead of Postgres. */
export const TEST_DIALECT: DatabaseDialect =
  process.env.TEST_DATABASE_DIALECT === 'sqlite' ? 'sqlite' : 'postgres';

/**
 * A fingerprint of the migration files and the journal, whose timestamps decide which
 * migrations count as applied, so a schema change gets a fresh template.
 */
function migrationsFingerprint(folder: string): string {
  const hash = createHash('sha1');
  for (const file of readdirSync(folder).sort()) {
    if (file.endsWith('.sql')) hash.update(readFileSync(join(folder, file)));
  }
  hash.update(readFileSync(join(folder, 'meta/_journal.json')));
  return hash.digest('hex').slice(0, 10);
}

const CORE_TEMPLATE = `manablox_test_template_${migrationsFingerprint(MIGRATIONS_FOLDER)}`;

/**
 * The template for `plugins` on `dialect`: the core template's name, plus a fingerprint of
 * each plugin's id and migrations when any has tables. Suites with the same plugin set share
 * it, so plugin tables are migrated once per set rather than once per suite.
 */
function templateName(core: string, plugins: readonly ManabloxPlugin[], dialect: DatabaseDialect) {
  const owners = pluginMigrations(plugins, dialect);
  if (owners.length === 0) return core;
  const hash = createHash('sha1');
  for (const owner of owners) hash.update(`${owner.id}:${migrationsFingerprint(owner.folder)};`);
  return `${core}_${hash.digest('hex').slice(0, 10)}`;
}

/**
 * Creates template `name` once per server, cloned from `from` or empty, then `fill`s it under
 * a build name that is renamed when done, so a crash never leaves a half-migrated template.
 * An advisory lock serialises suites.
 */
async function ensureTemplate(
  admin: postgres.Sql,
  name: string,
  from: string | null,
  fill: (handle: ReturnType<typeof createPostgresDatabase>) => Promise<void>,
): Promise<void> {
  await admin.unsafe(`select pg_advisory_lock(hashtext('${name}'))`);
  try {
    const [row] = await admin.unsafe(
      `select 1 as found from pg_database where datname = '${name}'`,
    );
    if (row) return;

    const build = `${name}_build`;
    await admin.unsafe(`drop database if exists "${build}" with (force)`);
    await admin.unsafe(`create database "${build}"${from ? ` template "${from}"` : ''}`);
    const handle = createPostgresDatabase({ url: withDatabase(TEST_ADMIN_URL, build), max: 1 });
    try {
      await fill(handle);
    } finally {
      await handle.close();
    }
    await admin.unsafe(`alter database "${build}" rename to "${name}"`);
  } finally {
    await admin.unsafe(`select pg_advisory_unlock(hashtext('${name}'))`);
  }
}

/** The migrated template for `plugins`, created on first use. */
async function postgresTemplate(
  admin: postgres.Sql,
  plugins: readonly ManabloxPlugin[],
): Promise<string> {
  await ensureTemplate(admin, CORE_TEMPLATE, null, async (handle) => {
    await applyBootstrapSql(handle.sql);
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  });
  const name = templateName(CORE_TEMPLATE, plugins, 'postgres');
  if (name !== CORE_TEMPLATE) {
    await ensureTemplate(admin, name, CORE_TEMPLATE, (handle) =>
      runPluginMigrations(handle, plugins),
    );
  }
  return name;
}

export function withDatabase(url: string, name: string): string {
  return url.replace(/\/[^/?]*(\?.*)?$/, `/${name}$1`);
}

export interface TestDatabase {
  name: string;
  url: string;
  /** Drops the database. Safe to call once every connection to it is closed. */
  drop: () => Promise<void>;
}

export interface TestDatabaseOptions {
  /** Defaults to `TEST_DIALECT`. */
  dialect?: DatabaseDialect;
  /** Creates the database without any schema. */
  empty?: boolean;
  /** Plugins whose tables are migrated on top of the core schema. */
  plugins?: readonly ManabloxPlugin[];
}

/** A fresh migrated database for one suite, cloned from the template of its plugin set. */
export async function createTestDatabase(
  prefix: string,
  options: TestDatabaseOptions = {},
): Promise<TestDatabase> {
  // Workers can be threads of one process; the random suffix keeps names apart.
  const name = `manablox_test_${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  const empty = options.empty ?? false;
  const plugins = options.plugins ?? [];
  if ((options.dialect ?? TEST_DIALECT) === 'sqlite') {
    return createSqliteTestDatabase(name, empty ? null : plugins);
  }

  const admin = postgres(TEST_ADMIN_URL, { max: 1 });
  try {
    if (empty) await admin.unsafe(`create database "${name}"`);
    else {
      const template = await postgresTemplate(admin, plugins);
      await admin.unsafe(`create database "${name}" template "${template}"`);
    }
  } finally {
    await admin.end();
  }

  return {
    name,
    url: withDatabase(TEST_ADMIN_URL, name),
    drop: async () => {
      const cleanup = postgres(TEST_ADMIN_URL, { max: 1 });
      try {
        await cleanup.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

const removeSqlite = (file: string) => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
};

/**
 * Builds template file `file` once, from a copy of `from` or empty; workers race to rename
 * their draft into place.
 */
async function ensureSqliteTemplate(
  file: string,
  from: string | null,
  fill: (handle: Awaited<ReturnType<typeof createDatabase>>) => Promise<void>,
): Promise<string> {
  if (existsSync(file)) return file;

  const draft = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  if (from) copyFileSync(from, draft);
  const handle = await createDatabase({ url: pathToFileURL(draft).href });
  try {
    await fill(handle);
    // Folds the WAL into the file so a plain copy carries the schema.
    if (handle.kind === 'sqlite') await handle.client.execute('pragma wal_checkpoint(truncate)');
  } finally {
    await handle.close();
  }
  if (!existsSync(file)) renameSync(draft, file);
  removeSqlite(draft);
  return file;
}

/** The migrated template file for `plugins`, created on first use. */
async function sqliteTemplate(plugins: readonly ManabloxPlugin[]): Promise<string> {
  const core = `manablox_test_template_${migrationsFingerprint(SQLITE_MIGRATIONS_FOLDER)}`;
  const coreFile = await ensureSqliteTemplate(join(tmpdir(), `${core}.db`), null, runMigrations);
  const name = templateName(core, plugins, 'sqlite');
  if (name === core) return coreFile;
  return ensureSqliteTemplate(join(tmpdir(), `${name}.db`), coreFile, (handle) =>
    runPluginMigrations(handle, plugins),
  );
}

/** A copy of the template for `plugins`, or an empty file when `plugins` is null. */
async function createSqliteTestDatabase(
  name: string,
  plugins: readonly ManabloxPlugin[] | null,
): Promise<TestDatabase> {
  const file = join(tmpdir(), `${name}.db`);
  if (plugins) copyFileSync(await sqliteTemplate(plugins), file);
  return {
    name,
    url: pathToFileURL(file).href,
    drop: async () => removeSqlite(file),
  };
}
