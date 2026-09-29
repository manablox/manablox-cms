import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { Database, Executor, Transaction } from './client.js';
import type { ContentTable, FieldFilter } from './query.js';

export type DialectName = 'postgres' | 'sqlite';

/** Types a bound value is cast to where the database cannot infer it. */
export type ParamType = 'uuid' | 'text' | 'int' | 'timestamptz' | 'ltree';

/** The SQL that differs between databases; repositories build everything else once. */
export interface Dialect {
  readonly name: DialectName;
  /** Bind parameters one statement may carry. */
  readonly maxParameters: number;

  /** Runs a raw statement and returns its rows. */
  rows<T = Record<string, unknown>>(db: Executor, query: SQL): Promise<T[]>;
  /** Runs a raw statement. */
  run(db: Executor, query: SQL): Promise<void>;

  /** A bound value, cast to `type`. */
  param(value: unknown, type: ParamType): SQL;
  /** A derived table of `rows`, one column per `columns` entry. */
  values(columns: Record<string, ParamType>, rows: Record<string, unknown>[]): SQL;
  /** The database's current time. */
  now(): SQL;

  /** Case-insensitive `LIKE`; `pattern` escapes with a backslash. */
  ilike(left: SQLWrapper, pattern: string): SQL;
  /** A JSON column as text, for `LIKE`. */
  jsonText(column: SQLWrapper): SQL;
  /** A JSON string array minus the elements matching the `LIKE` pattern. */
  jsonArrayWithout(column: SQLWrapper, pattern: string): SQL;
  /** A JSON object with `patch`'s keys set, others kept. */
  jsonMerge(column: SQLWrapper, patch: Record<string, unknown>): SQL;
  /** Elements in a JSON array. */
  jsonArrayLength(column: SQLWrapper): SQL;
  /** `value` as a JSON object with `key` set to an expression's value. */
  jsonObjectWith(value: object, key: string, expression: SQLWrapper): SQL;
  /** Whether field `name` of a `fields` object equals `value` exactly. */
  jsonFieldEquals(fields: SQLWrapper, name: string, value: unknown): SQL;

  /** Whether `path` is `ancestor` or lies below it. */
  pathWithin(path: SQLWrapper, ancestor: SQLWrapper): SQL;
  /** Whether the row aliased `alias` is `path`'s node or one of its ancestors. */
  isAncestorRow(alias: string, path: SQLWrapper): SQL;
  /** Labels in a path. */
  pathDepth(path: SQLWrapper): SQL;
  /** `path` with its `oldPrefix` swapped for `newPrefix`. */
  pathRebase(path: SQLWrapper, oldPrefix: string, newPrefix: string): SQL;

  /** Full-text match against the title and field contributions. */
  search(table: ContentTable, query: string): SQL;
  /** One field filter on a `fields` object; operators are already validated. */
  fieldCondition(fields: SQLWrapper, filter: FieldFilter): SQL;

  /** Locks the selected rows until the transaction ends. */
  forUpdate<T>(query: T): T;
  /** Serialises transactions holding `name` until they end. */
  lockInTransaction(tx: Transaction, name: string): Promise<void>;
  /** Runs `fn` while no other holder of `name` runs; `fn` writes outside any transaction. */
  withLock<T>(db: Database, name: string, fn: () => Promise<T>): Promise<T>;
}

/** Escapes `LIKE` wildcards for a backslash-escaped pattern. */
export const escapeLike = (value: string): string => value.replace(/[%_\\]/g, (c) => `\\${c}`);
