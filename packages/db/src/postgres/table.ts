import { type BuildColumns, type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  type IndexColumn,
  index,
  integer,
  jsonb,
  type PgColumnBuilder,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
  type PgTableWithColumns,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ltree, tsvector } from '../columns.js';
import {
  type AnyColumnDefinition,
  type AnyTableDefinition,
  type ColumnBuildersOf,
  type ColumnSpec,
  type Constraint,
  NOW,
  type TableDefinition,
} from '../definitions/define.js';

export type PostgresTable<TDefinition extends AnyTableDefinition> = PgTableWithColumns<{
  name: TDefinition['name'];
  schema: undefined;
  columns: BuildColumns<TDefinition['name'], ColumnBuildersOf<TDefinition['columns'], 'pg'>, 'pg'>;
  dialect: 'pg';
}>;

const built = new WeakMap<AnyTableDefinition, unknown>();

// biome-ignore lint/suspicious/noExplicitAny: builders of every column type chain the same way
type Builder = PgColumnBuilder<any, any, any, any>;

const SEARCH = sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(search_text, ''))`;

const base = (spec: ColumnSpec): Builder => {
  switch (spec.kind) {
    case 'id':
      return uuid().primaryKey().defaultRandom();
    case 'textId':
      return text()
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID());
    case 'uuid':
      return uuid();
    case 'text':
      return text();
    case 'integer':
      return integer();
    case 'bigint':
      return bigint({ mode: 'number' });
    case 'boolean':
      return boolean();
    case 'json':
      return jsonb();
    case 'timestamp':
      return spec.default === NOW
        ? timestamp({ withTimezone: true }).defaultNow()
        : timestamp({ withTimezone: true });
    case 'path':
      return ltree();
    case 'search':
      return tsvector().generatedAlwaysAs(SEARCH);
    case 'serial':
      return bigserial({ mode: 'number' });
  }
};

const defaultOf = (spec: ColumnSpec): unknown | SQL =>
  spec.kind === 'json' ? sql.raw(`'${JSON.stringify(spec.default)}'::jsonb`) : spec.default;

const column = (spec: ColumnSpec): PgColumnBuilderBase => {
  let builder = base(spec);
  if (spec.notNull) builder = builder.notNull();
  if (spec.hasDefault && spec.default !== undefined && spec.default !== NOW) {
    builder = builder.default(defaultOf(spec));
  }
  if (spec.reference) {
    const { table, column: key, onDelete } = spec.reference;
    builder = builder.references(
      () => postgresTable(table())[key] as AnyPgColumn,
      onDelete ? { onDelete } : {},
    );
  }
  if (spec.unique) builder = builder.unique(spec.unique);
  return builder as unknown as PgColumnBuilderBase;
};

const constraint = (entry: Constraint): PgTableExtraConfigValue | undefined => {
  switch (entry.kind) {
    case 'index': {
      if (entry.dialect && entry.dialect !== 'postgres') return undefined;
      const targets = entry.targets as [IndexColumn, ...IndexColumn[]];
      const builder = entry.unique ? uniqueIndex(entry.name) : index(entry.name);
      const bound = entry.method ? builder.using(entry.method, ...targets) : builder.on(...targets);
      return entry.condition ? bound.where(entry.condition) : bound;
    }
    case 'unique': {
      const bound = unique(entry.name).on(...(entry.columns as [AnyPgColumn, ...AnyPgColumn[]]));
      return entry.nullsDistinct ? bound : bound.nullsNotDistinct();
    }
    case 'primaryKey':
      return primaryKey({ columns: entry.columns as [AnyPgColumn, ...AnyPgColumn[]] });
  }
};

/** The Postgres table of a definition; built once, so references share it. */
export function postgresTable<
  TName extends string,
  TColumns extends Record<string, AnyColumnDefinition>,
>(definition: TableDefinition<TName, TColumns>): PostgresTable<TableDefinition<TName, TColumns>> {
  const cached = built.get(definition);
  if (cached) return cached as PostgresTable<TableDefinition<TName, TColumns>>;

  const columns = Object.fromEntries(
    Object.entries(definition.columns).map(([key, entry]) => [key, column(entry.spec)]),
  ) as ColumnBuildersOf<TColumns, 'pg'>;
  const table = pgTable(definition.name, columns, (self) =>
    definition
      .constraints(self as never)
      .map(constraint)
      .filter((entry) => entry !== undefined),
  );
  built.set(definition, table);
  return table;
}
