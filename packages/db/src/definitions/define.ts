import type {
  $Type,
  AnyColumn,
  HasDefault,
  HasGenerated,
  HasRuntimeDefault,
  IsPrimaryKey,
  NotNull,
  SQL,
} from 'drizzle-orm';
import type {
  ConvertCustomConfig,
  PgBigInt53BuilderInitial,
  PgBigSerial53BuilderInitial,
  PgBooleanBuilderInitial,
  PgColumnBuilderBase,
  PgCustomColumnBuilder,
  PgIntegerBuilderInitial,
  PgJsonbBuilderInitial,
  PgTextBuilderInitial,
  PgTimestampBuilderInitial,
  PgUUIDBuilderInitial,
} from 'drizzle-orm/pg-core';
import type {
  SQLiteBooleanBuilderInitial,
  SQLiteColumnBuilderBase,
  SQLiteIntegerBuilderInitial,
  SQLiteTextBuilderInitial,
  SQLiteTextJsonBuilderInitial,
  SQLiteTimestampBuilderInitial,
} from 'drizzle-orm/sqlite-core';
import type { DialectName } from '../dialect.js';

export type ColumnKind =
  | 'id'
  | 'textId'
  | 'uuid'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'boolean'
  | 'json'
  | 'timestamp'
  | 'path'
  | 'search'
  | 'serial';

/** The database's current time, as a column default. */
export const NOW = Symbol('now');

/** @public Named in the emitted declarations. */
export interface Reference {
  table: () => AnyTableDefinition;
  column: string;
  onDelete?: 'cascade' | 'set null';
}

/** What a column is, independent of the database. */
export interface ColumnSpec {
  readonly kind: ColumnKind;
  readonly notNull: boolean;
  /** `NOW`, a literal, or a JSON value for `json` columns; absent when there is none. */
  readonly default?: unknown;
  readonly hasDefault: boolean;
  readonly reference?: Reference;
  /** Name of a single-column unique constraint. */
  readonly unique?: string;
}

type PgText = PgTextBuilderInitial<'', [string, ...string[]]>;
/** `ltree` and `tsvector` are custom types over text. */
type PgCustom = PgCustomColumnBuilder<
  ConvertCustomConfig<'', { data: string; driverData: string }>
>;
type SqliteText = SQLiteTextBuilderInitial<'', [string, ...string[]], undefined>;

/**
 * A column of a table definition; `_` carries the builder each dialect makes of it.
 * @public
 */
export class ColumnDefinition<
  TPg extends PgColumnBuilderBase = PgColumnBuilderBase,
  TSqlite extends SQLiteColumnBuilderBase = SQLiteColumnBuilderBase,
  TData = unknown,
> {
  declare readonly _: { pg: TPg; sqlite: TSqlite; data: TData };

  constructor(readonly spec: ColumnSpec) {}

  private with(patch: Partial<ColumnSpec>): AnyColumnDefinition {
    return new ColumnDefinition({ ...this.spec, ...patch });
  }

  notNull(): ColumnDefinition<NotNull<TPg>, NotNull<TSqlite>, TData> {
    return this.with({ notNull: true });
  }

  default(value: TData): ColumnDefinition<HasDefault<TPg>, HasDefault<TSqlite>, TData> {
    return this.with({ default: value, hasDefault: true });
  }

  /** Timestamps only. */
  defaultNow(): ColumnDefinition<HasDefault<TPg>, HasDefault<TSqlite>, TData> {
    return this.with({ default: NOW, hasDefault: true });
  }

  references<T extends AnyTableDefinition>(
    table: () => T,
    column: keyof T['columns'] & string,
    actions?: { onDelete?: 'cascade' | 'set null' },
  ): ColumnDefinition<TPg, TSqlite, TData> {
    return this.with({ reference: { table, column, ...actions } });
  }

  unique(name: string): ColumnDefinition<TPg, TSqlite, TData> {
    return this.with({ unique: name });
  }
}

// biome-ignore lint/suspicious/noExplicitAny: a definition of any column shape
export type AnyColumnDefinition = ColumnDefinition<any, any, any>;

const column = <TPg extends PgColumnBuilderBase, TSqlite extends SQLiteColumnBuilderBase, TData>(
  kind: ColumnKind,
  spec: Partial<ColumnSpec> = {},
) =>
  new ColumnDefinition<TPg, TSqlite, TData>({ kind, notNull: false, hasDefault: false, ...spec });

/** A UUID primary key, generated on insert. */
export const id = () =>
  column<
    HasDefault<IsPrimaryKey<NotNull<PgUUIDBuilderInitial<''>>>>,
    HasRuntimeDefault<HasDefault<IsPrimaryKey<NotNull<SqliteText>>>>,
    string
  >('id', { notNull: true, hasDefault: true });

/** A text primary key: a UUID unless the writer picks another value. */
export const textId = () =>
  column<
    HasRuntimeDefault<HasDefault<IsPrimaryKey<NotNull<PgText>>>>,
    HasRuntimeDefault<HasDefault<IsPrimaryKey<NotNull<SqliteText>>>>,
    string
  >('textId', { notNull: true, hasDefault: true });

/** A UUID; text where the database has no such type. */
export const uuid = () => column<PgUUIDBuilderInitial<''>, SqliteText, string>('uuid');

/** Free text, or a string union for enum-like columns. */
export const text = <T extends string = string>() =>
  column<
    string extends T ? PgText : $Type<PgText, T>,
    string extends T ? SqliteText : $Type<SqliteText, T>,
    T
  >('text');

export const integer = () =>
  column<PgIntegerBuilderInitial<''>, SQLiteIntegerBuilderInitial<''>, number>('integer');

/** 64-bit, read back as a `number`. */
export const bigint = () =>
  column<PgBigInt53BuilderInitial<''>, SQLiteIntegerBuilderInitial<''>, number>('bigint');

export const boolean = () =>
  column<PgBooleanBuilderInitial<''>, SQLiteBooleanBuilderInitial<''>, boolean>('boolean');

/** A JSON document, typed as `T`. */
export const json = <T = unknown>() =>
  column<$Type<PgJsonbBuilderInitial<''>, T>, $Type<SQLiteTextJsonBuilderInitial<''>, T>, T>(
    'json',
  );

/** Millisecond precision, read back as a `Date`. */
export const timestamp = () =>
  column<PgTimestampBuilderInitial<''>, SQLiteTimestampBuilderInitial<''>, Date>('timestamp');

/** A node's materialised ancestor path. */
export const path = () => column<PgCustom, SqliteText, string>('path');

/** Generated full-text column over `title` and `search_text`; never written directly. */
export const search = () =>
  column<
    HasGenerated<PgCustom, { type: 'always' }>,
    HasGenerated<SqliteText, { type: 'always' }>,
    string
  >('search', { hasDefault: true });

/** An ever-increasing sequence number, assigned on insert. */
export const serial = () =>
  column<
    NotNull<PgBigSerial53BuilderInitial<''>>,
    HasRuntimeDefault<HasDefault<NotNull<SQLiteIntegerBuilderInitial<''>>>>,
    number
  >('serial', { notNull: true, hasDefault: true });

/** @public Named in the emitted declarations. */
export type IndexTarget = AnyColumn | SQL;

/**
 * An index; `using` makes it Postgres-only, `only` pins it to one dialect.
 * @public
 */
export class IndexDefinition {
  readonly kind = 'index';
  targets: IndexTarget[] = [];
  condition?: SQL;
  method?: 'gist' | 'gin';
  dialect?: DialectName;

  constructor(
    readonly name: string,
    readonly unique: boolean,
  ) {}

  on(...targets: [IndexTarget, ...IndexTarget[]]): this {
    this.targets = targets;
    return this;
  }

  using(method: 'gist' | 'gin', ...targets: [IndexTarget, ...IndexTarget[]]): this {
    this.method = method;
    this.targets = targets;
    return this;
  }

  where(condition: SQL): this {
    this.condition = condition;
    return this;
  }

  only(dialect: DialectName): this {
    this.dialect = dialect;
    return this;
  }
}

/**
 * A unique constraint; with `nullsNotDistinct` SQLite keeps it as an expression index in `0001_extras.sql`.
 * @public
 */
export class UniqueDefinition {
  readonly kind = 'unique';
  columns: AnyColumn[] = [];
  nullsDistinct = true;

  constructor(readonly name: string) {}

  on(...columns: [AnyColumn, ...AnyColumn[]]): this {
    this.columns = columns;
    return this;
  }

  nullsNotDistinct(): this {
    this.nullsDistinct = false;
    return this;
  }
}

export interface PrimaryKeyDefinition {
  readonly kind: 'primaryKey';
  readonly columns: AnyColumn[];
}

export type Constraint = IndexDefinition | UniqueDefinition | PrimaryKeyDefinition;

export const index = (name: string) => new IndexDefinition(name, false);
export const uniqueIndex = (name: string) => new IndexDefinition(name, true);
export const unique = (name: string) => new UniqueDefinition(name);
export const primaryKey = (...columns: [AnyColumn, ...AnyColumn[]]): PrimaryKeyDefinition => ({
  kind: 'primaryKey',
  columns,
});

/** The built columns a constraint callback receives, whichever dialect builds them. */
export type ConstraintColumns<TColumns> = { [K in keyof TColumns]: AnyColumn };

export interface TableDefinition<
  TName extends string = string,
  TColumns extends Record<string, AnyColumnDefinition> = Record<string, AnyColumnDefinition>,
> {
  readonly name: TName;
  readonly columns: TColumns;
  readonly constraints: (table: ConstraintColumns<TColumns>) => Constraint[];
}

// biome-ignore lint/suspicious/noExplicitAny: a definition of any table shape
export type AnyTableDefinition = TableDefinition<any, any>;

/** Describes a table once; each dialect builds its own from it. */
export const table = <TName extends string, TColumns extends Record<string, AnyColumnDefinition>>(
  name: TName,
  columns: TColumns,
  constraints: (table: ConstraintColumns<TColumns>) => Constraint[] = () => [],
): TableDefinition<TName, TColumns> => ({ name, columns, constraints });

/** The builders a dialect makes of a definition's columns. */
export type ColumnBuildersOf<
  TColumns extends Record<string, AnyColumnDefinition>,
  TDialect extends 'pg' | 'sqlite',
> = { [K in keyof TColumns]: TColumns[K]['_'][TDialect] };
