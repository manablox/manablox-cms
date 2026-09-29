import { and, count, eq, getTableColumns, inArray, type SQL, sql } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { batches } from '../batch.js';
import type { Tables } from '../tables.js';
import { Repository } from './base.js';

/** Tables whose rows carry an `environmentId`. */
export type EnvironmentRowKind =
  | 'contentTypes'
  | 'contents'
  | 'publishedContents'
  | 'menus'
  | 'redirects'
  | 'contentTags'
  | 'assetUsages';

/** Tables whose rows belong to an environment through a parent row. */
export type EnvironmentChildKind = 'contentVersions' | 'menuItems';

export type EnvironmentTableKind = EnvironmentRowKind | EnvironmentChildKind;

/** Kinds addressed by an `id` column. */
export type EnvironmentIdKind = Exclude<EnvironmentTableKind, 'contentTags' | 'assetUsages'>;

export type EnvironmentRow<K extends EnvironmentTableKind> = Tables[K]['$inferSelect'];
export type EnvironmentInsert<K extends EnvironmentTableKind> = Tables[K]['$inferInsert'];

/** The parent column of each child kind. */
const PARENT: Record<EnvironmentChildKind, 'contentId' | 'menuId'> = {
  contentVersions: 'contentId',
  menuItems: 'menuId',
};

/** Generated columns, never written. */
const GENERATED = new Set(['search']);

/** Database names of columns, as the client's `snake_case` casing derives them. */
const SNAKE = new CasingCache('snake_case');
/** Rows per JSON batch on Postgres. */
const JSON_BATCH = 2000;

type AnyTable = PgTable & Record<string, PgColumn>;

/**
 * Raw rows of one environment, table by table, for copying an environment and promoting one
 * into another. Callers own ids and references; nothing here runs hooks.
 */
export class EnvironmentRowsRepository extends Repository {
  private table(kind: EnvironmentTableKind): AnyTable {
    return this.t[kind] as unknown as AnyTable;
  }

  /** Every row of `kind` in the environment. */
  list<K extends EnvironmentRowKind>(kind: K, environmentId: string): Promise<EnvironmentRow<K>[]> {
    const table = this.table(kind);
    return this.db
      .select()
      .from(table as PgTable)
      .where(eq(table.environmentId as PgColumn, environmentId)) as unknown as Promise<
      EnvironmentRow<K>[]
    >;
  }

  /** Rows of `kind` in the environment whose `column` holds one of `values`. */
  async listWhereIn<K extends EnvironmentRowKind>(
    kind: K,
    environmentId: string,
    column: string,
    values: readonly string[],
  ): Promise<EnvironmentRow<K>[]> {
    const table = this.table(kind);
    const target = table[column] as PgColumn | undefined;
    if (!target) throw new Error(`No column ${column} on ${kind}.`);
    const out: EnvironmentRow<K>[] = [];
    for (const batch of batches([...new Set(values)], 1, this.dialect.maxParameters - 1)) {
      const rows = await this.db
        .select()
        .from(table as PgTable)
        .where(and(eq(table.environmentId as PgColumn, environmentId), inArray(target, batch)));
      out.push(...(rows as unknown as EnvironmentRow<K>[]));
    }
    return out;
  }

  /** Documents of the types in the environment. */
  ofTypes<K extends 'contents' | 'publishedContents'>(
    kind: K,
    environmentId: string,
    typeIds: readonly string[],
  ): Promise<EnvironmentRow<K>[]> {
    if (typeIds.length === 0) return Promise.resolve([]);
    const table = this.table(kind);
    return this.db
      .select()
      .from(table as PgTable)
      .where(
        and(
          eq(table.environmentId as PgColumn, environmentId),
          inArray(table.typeId as PgColumn, [...typeIds]),
        ),
      ) as unknown as Promise<EnvironmentRow<K>[]>;
  }

  /** Rows of a child kind under the parent rows. */
  async children<K extends EnvironmentChildKind>(
    kind: K,
    parentIds: readonly string[],
  ): Promise<EnvironmentRow<K>[]> {
    const table = this.table(kind);
    const column = table[PARENT[kind]] as PgColumn;
    const out: EnvironmentRow<K>[] = [];
    for (const batch of batches([...new Set(parentIds)], 1, this.dialect.maxParameters)) {
      const rows = await this.db
        .select()
        .from(table as PgTable)
        .where(inArray(column, batch));
      out.push(...(rows as unknown as EnvironmentRow<K>[]));
    }
    return out;
  }

  /**
   * Inserts rows as given, in batches. On Postgres a batch is one JSON parameter the database
   * spreads into rows (`jsonb_populate_recordset`): building a statement with a parameter per
   * value costs more than the insert itself at thousands of rows.
   */
  async insert<K extends EnvironmentTableKind>(
    kind: K,
    rows: readonly EnvironmentInsert<K>[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const table = this.table(kind);
    const values = rows.map((row) => writable(row as Record<string, unknown>));
    if (this.dialect.name === 'postgres') {
      await this.insertAsJson(table, values);
      return;
    }
    const columns = Object.keys(values[0] ?? {}).length;
    for (const batch of batches(values, columns, this.dialect.maxParameters)) {
      await this.db.insert(table as PgTable).values(batch as never);
    }
  }

  /** Postgres: `rows` as JSON, the columns of the first row named as the table names them. */
  private async insertAsJson(table: AnyTable, rows: Record<string, unknown>[]): Promise<void> {
    const byKey = getTableColumns(table as PgTable) as Record<string, PgColumn>;
    const keys = Object.keys(rows[0] ?? {}).filter((key) => byKey[key]);
    const names = keys.map((key) => SNAKE.getColumnCasing(byKey[key] as PgColumn));
    const columns = sql.join(
      names.map((name) => sql.identifier(name)),
      sql`, `,
    );
    for (let from = 0; from < rows.length; from += JSON_BATCH) {
      const batch = rows.slice(from, from + JSON_BATCH).map((row) => {
        const out: Record<string, unknown> = {};
        keys.forEach((key, index) => {
          out[names[index] as string] = row[key] === undefined ? null : row[key];
        });
        return out;
      });
      await this.db.execute(
        sql`insert into ${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::${table}, ${JSON.stringify(batch)}::jsonb)`,
      );
    }
  }

  /** Sets columns of one row. */
  async update<K extends EnvironmentIdKind>(
    kind: K,
    id: string,
    patch: Partial<EnvironmentInsert<K>>,
  ): Promise<void> {
    const table = this.table(kind);
    const values = writable(patch as Record<string, unknown>);
    delete values.id;
    if (Object.keys(values).length === 0) return;
    await this.db
      .update(table as PgTable)
      .set(values as never)
      .where(eq(table.id as PgColumn, id));
  }

  /** Deletes rows by id. */
  remove(kind: EnvironmentIdKind, ids: readonly string[]): Promise<void> {
    return this.removeBy(kind, 'id', ids);
  }

  /** Deletes rows whose `column` holds one of `values`, e.g. versions by `contentId`. */
  async removeBy(
    kind: EnvironmentTableKind,
    column: string,
    values: readonly string[],
  ): Promise<void> {
    const table = this.table(kind);
    const target = table[column] as PgColumn | undefined;
    if (!target) throw new Error(`No column ${column} on ${kind}.`);
    for (const batch of batches([...new Set(values)], 1, this.dialect.maxParameters)) {
      await this.db.delete(table as PgTable).where(inArray(target, batch));
    }
  }

  /** Deletes every row of `kind` in the environment. */
  async clear(kind: EnvironmentRowKind, environmentId: string): Promise<void> {
    const table = this.table(kind);
    await this.db
      .delete(table as PgTable)
      .where(eq(table.environmentId as PgColumn, environmentId));
  }

  /** Documents per content type in the environment, drafts table. */
  async countByType(environmentId: string): Promise<Map<string, number>> {
    const { contents } = this.t;
    const rows = await this.db
      .select({ typeId: contents.typeId, value: count() })
      .from(contents)
      .where(eq(contents.environmentId, environmentId))
      .groupBy(contents.typeId);
    return new Map(rows.map((row) => [row.typeId, row.value]));
  }

  /** Documents of a type in the environment holding a value for each field. */
  async countFieldValues(
    environmentId: string,
    typeId: string,
    fields: readonly string[],
  ): Promise<Map<string, number>> {
    const { contents } = this.t;
    const out = new Map<string, number>();
    for (const name of new Set(fields)) {
      const where: SQL | undefined = and(
        eq(contents.environmentId, environmentId),
        eq(contents.typeId, typeId),
        this.dialect.fieldCondition(contents.fields, { name, op: 'isNotNull' }),
      );
      const [row] = await this.db.select({ value: count() }).from(contents).where(where);
      out.set(name, row?.value ?? 0);
    }
    return out;
  }
}

/** A row without generated columns or undefined values. */
function writable(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (GENERATED.has(key) || value === undefined) continue;
    out[key] = value;
  }
  return out;
}
