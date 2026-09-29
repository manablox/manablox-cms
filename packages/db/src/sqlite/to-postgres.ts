import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { canonicalJson, databaseDialect } from '@manablox/core';
import { type AnyColumn, and, eq, or, type SQL, sql } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { backupSqlite } from '../backup.js';
import { createPostgresDatabase, type PostgresHandle, type SqliteHandle } from '../client.js';
import type { AnyColumnDefinition, AnyTableDefinition } from '../definitions/define.js';
import * as definitions from '../definitions/index.js';
import { migrationStatus, runMigrations } from '../migrate.js';
import {
  type MigrateDbOptions,
  MigrateDbRefused,
  type MigrateDbReport,
  type MigrateDbTable,
  redactUrl,
} from '../migrate-db.js';
import { postgresTable } from '../postgres/table.js';
import { AuditRepository } from '../repositories/audit.js';
import { appRolesOf, grantAppRole } from '../roles.js';
import { createSqliteDatabase, sqliteFile } from './client.js';
import { sqliteTable } from './table.js';

type Row = Record<string, unknown>;
type Columns = Record<string, AnyColumn>;

const columnsOf = (table: AnyTableDefinition): Record<string, AnyColumnDefinition> => table.columns;

const isDefinition = (value: unknown): value is AnyTableDefinition =>
  typeof value === 'object' && value !== null && 'columns' in value && 'constraints' in value;

const TABLES: AnyTableDefinition[] = Object.values(definitions).filter(isDefinition);

/** Tables ordered so every table follows the tables its foreign keys point at. */
export function copyOrder(tables: AnyTableDefinition[] = TABLES): AnyTableDefinition[] {
  const order: AnyTableDefinition[] = [];
  const done = new Set<AnyTableDefinition>();
  const visit = (table: AnyTableDefinition, trail: AnyTableDefinition[]) => {
    if (done.has(table)) return;
    if (trail.includes(table)) {
      throw new Error(`foreign keys form a cycle: ${[...trail, table].map((t) => t.name)}`);
    }
    for (const column of Object.values(columnsOf(table))) {
      const target = column.spec.reference?.table();
      if (target && target !== table) visit(target, [...trail, table]);
    }
    done.add(table);
    order.push(table);
  };
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) visit(table, []);
  return order;
}

/** Keys the copy writes; generated search columns are rebuilt by Postgres. */
const copiedKeys = (table: AnyTableDefinition): string[] =>
  Object.keys(table.columns).filter((key) => table.columns[key]?.spec.kind !== 'search');

const pick = (table: object, keys: string[]): Columns =>
  Object.fromEntries(keys.map((key) => [key, (table as Columns)[key] as AnyColumn]));

/** Primary key column keys, or none. */
function primaryKeyOf(table: AnyTableDefinition): string[] {
  const own = Object.keys(table.columns).filter((key) => {
    const kind = table.columns[key]?.spec.kind;
    return kind === 'id' || kind === 'textId';
  });
  if (own.length) return own;
  const built = postgresTable(table) as unknown as Columns;
  for (const entry of table.constraints(built as never)) {
    if (entry.kind !== 'primaryKey') continue;
    return entry.columns.map(
      (column) => Object.keys(built).find((key) => built[key] === column) as string,
    );
  }
  return [];
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function sqliteCount(handle: SqliteHandle, table: string): Promise<number> {
  const { rows } = await handle.client.execute(`select count(*) as n from ${quote(table)}`);
  return Number(rows[0]?.n ?? 0);
}

async function postgresCount(handle: PostgresHandle, table: string): Promise<number> {
  const [row] = await handle.sql.unsafe(`select count(*)::int as n from ${quote(table)}`);
  return Number(row?.n ?? 0);
}

/** The instance-wide `state` status (`active` when unset) and when it was set. */
async function instanceState(handle: SqliteHandle): Promise<{ status: string; since: number }> {
  const { rows } = await handle.client.execute(
    "select value, updated_at from control_settings where scope_kind = 'instance' and scope_id = '' and key = 'state'",
  );
  const value = rows[0]?.value;
  if (typeof value !== 'string') return { status: 'active', since: 0 };
  const parsed = JSON.parse(value) as { status?: unknown };
  return {
    status: typeof parsed?.status === 'string' ? parsed.status : 'active',
    since: Number(rows[0]?.updated_at ?? 0),
  };
}

/** Tables of the target's public schema that hold rows. */
async function tablesWithRows(handle: PostgresHandle): Promise<string[]> {
  const tables = await handle.sql<{ name: string }[]>`
    select tablename as name from pg_tables where schemaname = 'public' order by tablename`;
  const filled: string[] = [];
  for (const { name } of tables) {
    const [row] = await handle.sql.unsafe(`select exists (select 1 from ${quote(name)}) as found`);
    if (row?.found) filled.push(name);
  }
  return filled;
}

/** Source rowids with rows that a self-reference points at placed first. */
async function parentFirstRowids(
  handle: SqliteHandle,
  table: AnyTableDefinition,
  selfRefs: string[],
): Promise<number[]> {
  const targets = [...new Set(selfRefs.map((key) => table.columns[key]?.spec.reference?.column))];
  const select = [
    'rowid as r',
    ...selfRefs.map((key, i) => `${quote(toSnakeCase(key))} as ref${i}`),
    ...targets.map((key, i) => `${quote(toSnakeCase(key as string))} as target${i}`),
  ];
  const { rows } = await handle.client.execute(
    `select ${select.join(', ')} from ${quote(table.name)} order by rowid`,
  );
  // Referenced value per target column -> rowid.
  const byTarget = targets.map((_, i) => new Map(rows.map((row) => [row[`target${i}`], row.r])));
  const children = new Map<unknown, number[]>();
  const waiting = new Map<number, number>();
  for (const row of rows) {
    const rowid = Number(row.r);
    let parents = 0;
    selfRefs.forEach((key, i) => {
      const value = row[`ref${i}`];
      if (value === null || value === undefined) return;
      const target = table.columns[key]?.spec.reference?.column;
      const parent = byTarget[targets.indexOf(target)]?.get(value);
      if (parent === undefined || Number(parent) === rowid) return;
      parents++;
      children.set(Number(parent), [...(children.get(Number(parent)) ?? []), rowid]);
    });
    waiting.set(rowid, parents);
  }
  const order = rows.map((row) => Number(row.r)).filter((rowid) => waiting.get(rowid) === 0);
  for (let i = 0; i < order.length; i++) {
    for (const child of children.get(order[i] as number) ?? []) {
      const left = (waiting.get(child) ?? 0) - 1;
      waiting.set(child, left);
      if (left === 0) order.push(child);
    }
  }
  if (order.length !== rows.length) {
    throw new MigrateDbRefused(`${table.name}: rows reference each other in a cycle`);
  }
  return order;
}

/** Reads a table's rows in batches, parents before children for self-references. */
async function* readRows(
  source: SqliteHandle,
  table: AnyTableDefinition,
  batchSize: number,
): AsyncGenerator<Row[]> {
  const db = source.db as unknown as LibSQLDatabase;
  const from = sqliteTable(table);
  const fields = { ...pick(from, copiedKeys(table)), _rowid: sql<number>`rowid` };
  const selfRefs = Object.keys(table.columns).filter(
    (key) => table.columns[key]?.spec.reference?.table() === table,
  );
  const strip = (rows: Row[]) => rows.map(({ _rowid, ...row }) => row);

  if (selfRefs.length === 0) {
    let after = 0;
    for (;;) {
      const rows = (await db
        .select(fields)
        .from(from)
        .where(sql`rowid > ${after}`)
        .orderBy(sql`rowid`)
        .limit(batchSize)) as Row[];
      if (rows.length === 0) return;
      after = Number(rows.at(-1)?._rowid);
      yield strip(rows);
    }
  }

  const order = await parentFirstRowids(source, table, selfRefs);
  for (let offset = 0; offset < order.length; offset += batchSize) {
    const chunk = order.slice(offset, offset + batchSize);
    const rows = (await db
      .select(fields)
      .from(from)
      .where(
        sql`rowid in (${sql.join(
          chunk.map((rowid) => sql`${rowid}`),
          sql`, `,
        )})`,
      )) as Row[];
    const byRowid = new Map(rows.map((row) => [Number(row._rowid), row]));
    yield strip(chunk.map((rowid) => byRowid.get(rowid) as Row));
  }
}

/** Resets each serial column's sequence past the copied values. */
async function resetSequences(
  tx: { execute: (query: SQL) => Promise<unknown> },
  table: AnyTableDefinition,
): Promise<void> {
  for (const [key, column] of Object.entries(columnsOf(table))) {
    if (column.spec.kind !== 'serial') continue;
    const name = toSnakeCase(key);
    await tx.execute(
      sql`select setval(pg_get_serial_sequence(${quote(table.name)}, ${name}),
        coalesce((select max(${sql.identifier(name)}) from ${sql.identifier(table.name)}), 0) + 1,
        false)`,
    );
  }
}

/** Up to `size` random rows per table compared field by field; returns the differences. */
async function compareSample(
  source: SqliteHandle,
  target: PostgresHandle,
  table: AnyTableDefinition,
  size: number,
): Promise<{ sampled: number; mismatches: string[] }> {
  const keys = copiedKeys(table);
  const primary = primaryKeyOf(table);
  if (primary.length === 0 || size <= 0) return { sampled: 0, mismatches: [] };
  const from = sqliteTable(table);
  const to = postgresTable(table) as unknown as Columns;
  const rows = (await (source.db as unknown as LibSQLDatabase)
    .select(pick(from, keys) as never)
    .from(from)
    .orderBy(sql`random()`)
    .limit(size)) as Row[];
  if (rows.length === 0) return { sampled: 0, mismatches: [] };

  const keyOf = (row: Row) => canonicalJson(primary.map((key) => row[key]));
  const found = (await target.db
    .select(pick(to, keys) as never)
    .from(to as never)
    .where(
      or(
        ...rows.map((row) =>
          and(...primary.map((key) => eq(to[key] as AnyColumn, row[key] as never))),
        ),
      ),
    )) as Row[];
  const byKey = new Map(found.map((row) => [keyOf(row), row]));

  const mismatches: string[] = [];
  for (const row of rows) {
    const copy = byKey.get(keyOf(row));
    if (!copy) {
      mismatches.push(`${table.name} ${keyOf(row)}: missing on the target`);
      continue;
    }
    for (const key of keys) {
      if (canonicalJson(row[key]) !== canonicalJson(copy[key])) {
        mismatches.push(`${table.name} ${keyOf(row)}: ${key} differs`);
      }
    }
  }
  return { sampled: rows.length, mismatches };
}

/** Checks the source, then copies and verifies. */
export async function copySqliteToPostgres(options: MigrateDbOptions): Promise<MigrateDbReport> {
  const log = options.log ?? (() => {});
  const batchSize = Math.max(1, options.batchSize ?? 1000);
  if (databaseDialect(options.source.url) !== 'sqlite') {
    throw new MigrateDbRefused('the configured database is not SQLite; nothing to migrate');
  }
  if (databaseDialect(options.target) !== 'postgres') {
    throw new MigrateDbRefused('--to must be a postgres:// or postgresql:// URL');
  }

  const live = (await createSqliteDatabase({ ...options.source, max: 2 })) as SqliteHandle;
  let source: SqliteHandle = live;
  let snapshot: string | null = null;
  try {
    const state = await instanceState(live);
    if (state.status === 'active' && !options.forceOffline) {
      throw new MigrateDbRefused(
        'the instance is active: set its state to readOnly through the control API, or stop it and pass --force-offline',
      );
    }
    // Other processes see a new state within their controls cache lifetime.
    const settle = state.since + (options.settleMs ?? 5000) - Date.now();
    if (state.status !== 'active' && settle > 0) {
      log(`waiting ${Math.ceil(settle / 1000)}s for every process to see the state`);
      await sleep(settle);
    }
    const migrations = await migrationStatus(live, options.plugins);
    const pending =
      migrations.pending + migrations.plugins.reduce((sum, plugin) => sum + plugin.pending, 0);
    if (pending > 0) {
      throw new MigrateDbRefused(
        `the SQLite database misses ${pending} migration(s); run manablox migrate first`,
      );
    }

    // A consistent copy to read from while a read-only instance keeps serving.
    const file = sqliteFile(options.source.url);
    if (file && file !== ':memory:') {
      snapshot = `${file}.to-postgres-${randomBytes(4).toString('hex')}`;
      log(`snapshot of ${file}`);
      await backupSqlite(live, snapshot);
      const url = pathToFileURL(resolve(snapshot)).href;
      source = (await createSqliteDatabase({ url, max: 2 })) as SqliteHandle;
    }

    const { rows: orphans } = await source.client.execute('pragma foreign_key_check');
    if (orphans.length > 0) {
      const tables = [...new Set(orphans.map((row) => `${row.table} -> ${row.parent}`))];
      throw new MigrateDbRefused(
        `${orphans.length} row(s) point at missing rows (${tables.join(', ')}); fix them first`,
      );
    }

    return await copyInto(source, options, batchSize, log);
  } finally {
    if (source !== live) await source.close();
    await live.close();
    for (const suffix of snapshot ? ['', '-wal', '-shm'] : []) {
      rmSync(`${snapshot}${suffix}`, { force: true });
    }
  }
}

async function copyInto(
  source: SqliteHandle,
  options: MigrateDbOptions,
  batchSize: number,
  log: (line: string) => void,
): Promise<MigrateDbReport> {
  const target = createPostgresDatabase({ url: options.target, max: 2 });
  try {
    // Read before a replace drops the schema and the grants with it.
    const appRoles = options.appRole ? [options.appRole] : await appRolesOf(target.sql);
    const filled = await tablesWithRows(target);
    if (filled.length > 0) {
      if (!options.replace) {
        throw new MigrateDbRefused(
          `the target database is not empty (${filled.slice(0, 5).join(', ')}${filled.length > 5 ? ', ...' : ''}); pass --replace to drop its schema`,
        );
      }
      log('dropping the target schema');
      await target.sql.unsafe(
        'drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;',
      );
    }

    log(`migrating ${redactUrl(options.target)}`);
    await runMigrations(target, options.plugins);
    for (const role of appRoles) {
      log(`granting ${role}`);
      await grantAppRole(target.sql, role);
    }

    const order = copyOrder([
      ...TABLES,
      ...(options.plugins ?? []).flatMap((plugin) =>
        Object.values(plugin.db?.tables ?? {}).filter(isDefinition),
      ),
    ]);
    const copied = new Map<string, number>();
    // One transaction: a failed copy leaves the migrated schema without rows.
    await target.db.transaction(async (tx) => {
      for (const table of order) {
        const into = postgresTable(table);
        const columns = copiedKeys(table).length;
        const chunk = Math.max(1, Math.min(batchSize, Math.floor(60_000 / columns)));
        let count = 0;
        for await (const rows of readRows(source, table, chunk)) {
          await tx.insert(into).values(rows as never);
          count += rows.length;
        }
        await resetSequences(tx, table);
        copied.set(table.name, count);
        log(`copied ${table.name}: ${count}`);
      }
    });

    log('verifying');
    const tables: MigrateDbTable[] = [];
    const mismatches: string[] = [];
    for (const table of order) {
      const entry = {
        name: table.name,
        source: await sqliteCount(source, table.name),
        target: await postgresCount(target, table.name),
      };
      tables.push(entry);
      if (entry.source !== entry.target || copied.get(table.name) !== entry.source) {
        mismatches.push(
          `${table.name}: ${entry.source} rows on SQLite, ${entry.target} on Postgres`,
        );
      }
    }

    const audit = {
      source: await new AuditRepository(source).verify(),
      target: await new AuditRepository(target).verify(),
    };
    if (audit.target.ok !== audit.source.ok || audit.target.checked !== audit.source.checked) {
      mismatches.push(
        `audit chain: ${audit.source.ok ? 'valid' : 'broken'} on SQLite, ${audit.target.ok ? 'valid' : `broken at seq ${audit.target.brokenAt?.seq}`} on Postgres`,
      );
    }

    let sampled = 0;
    const size = options.sampleSize ?? 100;
    for (const table of order) {
      const result = await compareSample(source, target, table, size);
      sampled += result.sampled;
      mismatches.push(...result.mismatches);
    }

    return { tables, audit, sampled, mismatches, ok: mismatches.length === 0 };
  } finally {
    await target.close();
  }
}
