import { type BuildColumns, type SQL, sql } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import {
  type AnySQLiteColumn,
  sqliteTable as defineSqliteTable,
  type IndexColumn,
  index,
  integer,
  primaryKey,
  type SQLiteColumnBuilder,
  type SQLiteColumnBuilderBase,
  type SQLiteTableExtraConfigValue,
  type SQLiteTableWithColumns,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  type AnyColumnDefinition,
  type AnyTableDefinition,
  type ColumnBuildersOf,
  type ColumnSpec,
  type Constraint,
  NOW,
  type TableDefinition,
} from '../definitions/define.js';

export type SqliteTable<TDefinition extends AnyTableDefinition> = SQLiteTableWithColumns<{
  name: TDefinition['name'];
  schema: undefined;
  columns: BuildColumns<
    TDefinition['name'],
    ColumnBuildersOf<TDefinition['columns'], 'sqlite'>,
    'sqlite'
  >;
  dialect: 'sqlite';
}>;

const built = new WeakMap<AnyTableDefinition, unknown>();

// biome-ignore lint/suspicious/noExplicitAny: builders of every column type chain the same way
type Builder = SQLiteColumnBuilder<any, any, any, any>;

/** Epoch milliseconds, as `now()` is stored. */
export const SQLITE_NOW = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

/** Text the search filter matches words against. */
const SEARCH = sql`coalesce(title, '') || ' ' || coalesce(search_text, '')`;

const base = (spec: ColumnSpec, table: string, key: string): Builder => {
  switch (spec.kind) {
    case 'id':
    case 'textId':
      return text()
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID());
    case 'uuid':
    case 'text':
    case 'path':
      return text();
    case 'integer':
    case 'bigint':
      return integer();
    case 'boolean':
      return integer({ mode: 'boolean' });
    case 'json':
      return text({ mode: 'json' });
    case 'timestamp':
      return integer({ mode: 'timestamp_ms' });
    case 'search':
      return text().generatedAlwaysAs(SEARCH, { mode: 'virtual' });
    case 'serial': {
      // Writers are serialised, so the next value is the maximum plus one.
      const next = sql.raw(`(select coalesce(max(${toSnakeCase(key)}), 0) + 1 from ${table})`);
      return integer().$defaultFn(() => next as never);
    }
  }
};

const defaultOf = (spec: ColumnSpec): unknown | SQL => {
  if (spec.default === NOW) return SQLITE_NOW;
  return spec.kind === 'json' ? sql.raw(`'${JSON.stringify(spec.default)}'`) : spec.default;
};

const column = (spec: ColumnSpec, table: string, key: string): SQLiteColumnBuilderBase => {
  let builder = base(spec, table, key);
  if (spec.notNull) builder = builder.notNull();
  if (spec.hasDefault && spec.default !== undefined) builder = builder.default(defaultOf(spec));
  if (spec.reference) {
    const { table: target, column: targetKey, onDelete } = spec.reference;
    builder = builder.references(
      () => sqliteTable(target())[targetKey] as AnySQLiteColumn,
      onDelete ? { onDelete } : {},
    );
  }
  return builder as unknown as SQLiteColumnBuilderBase;
};

const constraint = (entry: Constraint): SQLiteTableExtraConfigValue | undefined => {
  switch (entry.kind) {
    case 'index': {
      if (entry.method || (entry.dialect && entry.dialect !== 'sqlite')) return undefined;
      const targets = entry.targets as [IndexColumn, ...IndexColumn[]];
      const bound = (entry.unique ? uniqueIndex(entry.name) : index(entry.name)).on(...targets);
      return entry.condition ? bound.where(entry.condition) : bound;
    }
    case 'unique': {
      if (!entry.nullsDistinct) return undefined;
      return uniqueIndex(entry.name).on(...(entry.columns as [IndexColumn, ...IndexColumn[]]));
    }
    case 'primaryKey':
      return primaryKey({ columns: entry.columns as [AnySQLiteColumn, ...AnySQLiteColumn[]] });
  }
};

/** The SQLite table of a definition; built once, so references share it. */
export function sqliteTable<
  TName extends string,
  TColumns extends Record<string, AnyColumnDefinition>,
>(definition: TableDefinition<TName, TColumns>): SqliteTable<TableDefinition<TName, TColumns>> {
  const cached = built.get(definition);
  if (cached) return cached as SqliteTable<TableDefinition<TName, TColumns>>;

  const columns = Object.fromEntries(
    Object.entries(definition.columns).map(([key, entry]) => [
      key,
      column(entry.spec, definition.name, key),
    ]),
  ) as ColumnBuildersOf<TColumns, 'sqlite'>;
  const table = defineSqliteTable(definition.name, columns, (self) => [
    ...definition
      .constraints(self as never)
      .map(constraint)
      .filter((entry) => entry !== undefined),
    // Single-column uniques are unique indexes here.
    ...Object.entries(definition.columns).flatMap(([key, entry]) =>
      entry.spec.unique
        ? [uniqueIndex(entry.spec.unique).on(self[key as keyof typeof self] as IndexColumn)]
        : [],
    ),
  ]);
  built.set(definition, table);
  return table;
}
