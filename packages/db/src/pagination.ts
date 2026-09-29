import { and, count, eq, getTableColumns, gt, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { alias, type PgColumn, type PgTable, type SelectedFields } from 'drizzle-orm/pg-core';
import type { Executor } from './client.js';
import type { Pagination } from './query.js';

export interface Paginated<T> {
  items: T[];
  /** Every matching row, or the cap when `capped`. */
  total: number;
  limit: number;
  offset: number;
  /** Counting stopped at a cap: there are more than `total` rows. */
  capped?: boolean;
}

/** Rows per page when the caller passes no pagination. */
export const DEFAULT_PAGE_SIZE = 50;
/** The first page of `limit` rows. */
export const firstPage = (limit = DEFAULT_PAGE_SIZE): Pagination => ({ limit, offset: 0 });

/** The most tags one listing returns; a space's vocabulary stays small enough to send at once. */
export const TAG_LIST_LIMIT = 500;
/** Review decisions shown with a document's approval state. */
export const APPROVAL_HISTORY_LIMIT = 20;
/** Scheduled publications or unpublications one sweep claims. */
export const DUE_PUBLICATION_BATCH = 50;
/** Audit entries per batch while verifying the chain. */
export const AUDIT_VERIFY_BATCH = 500;
/** Audit lists count at most this many entries; past it they report `capped`. */
export const AUDIT_COUNT_CAP = 10_000;

interface PageOptions {
  where?: SQL | undefined;
  orderBy: SQL | PgColumn | (SQL | PgColumn)[];
  pagination: Pagination;
  /** Counts at most this many rows; past it `total` is the cap and `capped` is set. */
  countCap?: number | undefined;
}

/** The row count of the whole result, beside each row. */
export const countOver = () => sql<number>`count(*) over ()`.mapWith(Number);

/**
 * One page plus its total. The order always ends with the table's `id`, so rows with equal
 * sort keys (a batch inserted in one statement shares its timestamps) never repeat or go
 * missing between pages.
 *
 * The page is read on its own, so an index on the order serves it without reading every
 * match; the total comes from a separate count only when the page does not tell it (a full
 * page, or one past the end), and stops at `countCap` when one is given.
 */
export function paginate<TTable extends PgTable>(
  db: Executor,
  table: TTable,
  options: PageOptions,
): Promise<Paginated<TTable['$inferSelect']>>;
/** One page of `columns` only. */
export function paginate<TRow>(
  db: Executor,
  table: PgTable,
  options: PageOptions & { columns: SelectedFields },
): Promise<Paginated<TRow>>;
export async function paginate(
  db: Executor,
  table: PgTable,
  options: PageOptions & { columns?: SelectedFields | undefined },
): Promise<Paginated<Record<string, unknown>>> {
  const id = (getTableColumns(table) as Record<string, PgColumn | undefined>).id;
  const orderBy = [
    ...(Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy]),
    ...(id ? [id] : []),
  ];
  const { limit, offset } = options.pagination;
  const items = (await db
    .select(options.columns ?? getTableColumns(table))
    .from(table)
    .where(options.where)
    .orderBy(...orderBy)
    .limit(limit)
    .offset(offset)) as Array<Record<string, unknown>>;

  const page = { items, limit, offset };
  // A page short of the limit is the last one: it tells the total.
  if (items.length > 0 && items.length < limit) return { ...page, total: offset + items.length };
  if (items.length === 0 && offset === 0) return { ...page, total: 0 };
  const cap = options.countCap;
  const total = await countRows(db, table, options.where, cap === undefined ? undefined : cap + 1);
  if (cap !== undefined && total > cap) {
    return { ...page, total: Math.max(cap, offset + items.length), capped: true };
  }
  return { ...page, total };
}

/** Matching rows, counting at most `upTo`. */
async function countRows(
  db: Executor,
  table: PgTable,
  where: SQL | undefined,
  upTo: number | undefined,
): Promise<number> {
  if (upTo === undefined) {
    const [row] = await db.select({ count: count() }).from(table).where(where);
    return row?.count ?? 0;
  }
  const matches = db
    .select({ one: sql`1`.as('one') })
    .from(table)
    .where(where)
    .limit(upTo)
    .as('matches');
  const [row] = await db.select({ count: count() }).from(matches);
  return row?.count ?? 0;
}

/** A column of a keyset order, ascending unless `desc`. */
export interface KeysetColumn {
  column: PgColumn;
  desc?: boolean;
}

export interface KeysetOptions {
  where?: SQL | undefined;
  /** Not-null columns; the table's `id` is appended as the last one. */
  order: readonly KeysetColumn[];
  /** Rows per batch. */
  batch: number;
  columns?: SelectedFields | undefined;
}

/**
 * Every matching row in batches, each read after the last row of the batch before by that
 * row's own stored values (compared in SQL, so no precision is lost): no OFFSET, no count, so
 * a batch costs the same at the end as at the start. A row inserted or deleted meanwhile
 * shifts nothing; a deleted cursor row resumes after the newest row read that is still
 * there, without repeating a row.
 */
export async function* keysetBatches<TRow extends { id: string }>(
  db: Executor,
  table: PgTable,
  options: KeysetOptions,
): AsyncGenerator<TRow[]> {
  const columns = getTableColumns(table) as Record<string, PgColumn | undefined>;
  const id = columns.id;
  if (!id) throw new Error('keysetBatches needs a table with an id column.');
  const order: KeysetColumn[] = [...options.order, { column: id }];
  const read: string[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const rows = (await db
      .select(options.columns ?? getTableColumns(table))
      .from(table)
      .where(and(options.where, after === null ? undefined : afterRow(table, id, order, after)))
      .orderBy(...order.map(({ column, desc }) => (desc ? sql`${column} desc` : column)))
      .limit(options.batch)) as unknown as TRow[];
    const fresh = rows.filter((row) => !seen.has(row.id));
    if (rows.length === 0 && after !== null) {
      const back = await lastStillThere(db, table, id, read);
      if (back !== after) {
        after = back;
        if (after !== null || read.length > 0) continue;
      }
      return;
    }
    if (fresh.length > 0) {
      for (const row of fresh) {
        seen.add(row.id);
        read.push(row.id);
      }
      yield fresh;
    }
    const last = rows.at(-1);
    if (!last || rows.length < options.batch) return;
    after = last.id;
  }
}

/**
 * Rows after the row `cursor` in `order`, compared with the cursor's stored values: one row
 * comparison when every column runs the same way (an index on the order serves it), else the
 * expanded form.
 */
function afterRow(table: PgTable, id: PgColumn, order: KeysetColumn[], cursor: string): SQL {
  const name = sql.identifier('keyset_cursor');
  const k = alias(table, 'keyset_cursor') as unknown as Record<string, PgColumn>;
  const keys = new Map(
    Object.entries(getTableColumns(table) as Record<string, PgColumn>).map(([key, column]) => [
      column,
      key,
    ]),
  );
  const own = (column: PgColumn) => k[keys.get(column) as string] as PgColumn;
  const cursorRow = (columns: SQL) =>
    sql`(select ${columns} from ${table} ${name} where ${own(id)} = ${cursor})`;
  const list = (columns: PgColumn[]) => sql.join(columns, sql`, `);

  const direction = order[0]?.desc === true;
  if (order.every((each) => (each.desc === true) === direction)) {
    const columns = order.map((each) => each.column);
    const row = cursorRow(list(columns.map(own)));
    return direction ? sql`(${list(columns)}) < ${row}` : sql`(${list(columns)}) > ${row}`;
  }
  const of = (column: PgColumn) => cursorRow(sql`${own(column)}`);
  const branches = order.map(({ column, desc }, index) =>
    and(
      ...order.slice(0, index).map((before) => eq(before.column, of(before.column))),
      desc ? lt(column, of(column)) : gt(column, of(column)),
    ),
  );
  return or(...branches) as SQL;
}

/** The newest of `read` (in read order) still in the table; `null` when none is. */
async function lastStillThere(
  db: Executor,
  table: PgTable,
  id: PgColumn,
  read: readonly string[],
): Promise<string | null> {
  for (let end = read.length; end > 0; end -= 500) {
    const ids = read.slice(Math.max(0, end - 500), end);
    const found = new Set(
      ((await db.select({ id }).from(table).where(inArray(id, ids))) as Array<{ id: string }>).map(
        (row) => row.id,
      ),
    );
    for (let index = ids.length - 1; index >= 0; index--) {
      const candidate = ids[index] as string;
      if (found.has(candidate)) return candidate;
    }
  }
  return null;
}
