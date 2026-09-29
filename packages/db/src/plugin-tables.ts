import type { AnyTableDefinition } from './definitions/define.js';
import type { DialectName } from './dialect.js';
import { type PostgresTable, postgresTable } from './postgres/table.js';
import { sqliteTable } from './sqlite/table.js';

/** Table definitions by key, as a plugin declares them. */
export type TableDefinitions = Readonly<Record<string, AnyTableDefinition>>;

/** Tables built for one dialect, typed as Postgres like the core ones. */
export type BuiltTables<T extends TableDefinitions> = { [K in keyof T]: PostgresTable<T[K]> };

declare module '@manablox/core' {
  interface PluginDatabase {
    /** The plugin's table definitions. */
    tables: TableDefinitions;
  }
}

const built: Record<DialectName, WeakMap<TableDefinitions, unknown>> = {
  postgres: new WeakMap(),
  sqlite: new WeakMap(),
};

/** The tables of `definitions` for `dialect`, for a plugin repository's `t`. */
export function buildTables<T extends TableDefinitions>(
  definitions: T,
  dialect: DialectName,
): BuiltTables<T> {
  const cached = built[dialect].get(definitions);
  if (cached) return cached as BuiltTables<T>;
  const build = dialect === 'sqlite' ? sqliteTable : postgresTable;
  const tables = Object.fromEntries(
    Object.entries(definitions).map(([key, definition]) => [key, build(definition)]),
  ) as unknown as BuiltTables<T>;
  built[dialect].set(definitions, tables);
  return tables;
}
