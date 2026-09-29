import { type Scope, scopeSpaceId } from '@manablox/core';
import { and, asc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { batches } from '../batch.js';
import type { Database, DatabaseHandle } from '../client.js';
import type { Dialect } from '../dialect.js';
import { type Paginated, paginate } from '../pagination.js';
import type { Pagination } from '../query.js';
import type { Tables } from '../tables.js';
import type { AuditAppendInput } from './audit.js';

/** Side effects held until the transaction a repository is bound to commits. */
export interface UnitOfWork {
  afterCommit(fn: () => unknown): void;
  /** Queues an audit entry, written with the others right before the outermost commit. */
  appendAudit(input: AuditAppendInput): void;
}

/** What a repository needs from a database handle; `unit` is set inside `repos.transaction`. */
export type DatabaseContext = Pick<DatabaseHandle, 'db' | 'tables' | 'dialect'> & {
  unit?: UnitOfWork | undefined;
};

/** A table addressed by its `id` column. */
type IdTable = PgTable & { id: PgColumn };

/** A table with rows ordered by creation. */
type LogTable = IdTable & { createdAt: PgColumn };

/** A table of environment-scoped rows. */
export interface ScopedTable {
  spaceId: PgColumn;
  environmentId: PgColumn;
}

/** A row's space and environment; the space's production environment when `environmentId` is absent. */
export interface ScopedWrite {
  spaceId: string;
  environmentId?: string | null | undefined;
}

/** The id of a space's production environment, as a subquery. */
export function productionOf(t: Tables, spaceId: string | SQL | PgColumn): SQL {
  const e = t.spaceEnvironments;
  return sql`(select ${e.id} from ${e} where ${e.spaceId} = ${spaceId} and ${e.kind} = 'production')`;
}

/** Whether a row of `table` is in a production environment. */
export function inProduction(t: Tables, table: ScopedTable): SQL {
  const e = t.spaceEnvironments;
  return sql`${table.environmentId} in (select ${e.id} from ${e} where ${e.kind} = 'production')`;
}

/** One bounded batch of a space's rows older than `before`. */
export interface AgeCutoff {
  spaceId: string;
  before: Date;
  limit: number;
}

/**
 * Repositories read tables from `t`, so each dialect supplies its own. A plugin passes its
 * own tables (see `buildTables`); `core` keeps the core ones.
 */
export abstract class Repository<TTables extends object = Tables> {
  protected readonly db: Database;
  protected readonly t: TTables;
  protected readonly core: Tables;
  protected readonly dialect: Dialect;
  protected readonly unit: UnitOfWork | undefined;

  constructor(context: DatabaseContext, ...tables: Tables extends TTables ? [] : [TTables]) {
    this.db = context.db;
    this.core = context.tables;
    this.t = (tables[0] ?? context.tables) as TTables;
    this.dialect = context.dialect;
    this.unit = context.unit;
  }

  /** The environment id of `scope`: its own, or its space's production environment. */
  protected environmentOf(scope: Scope | ScopedWrite): string | SQL {
    if (typeof scope === 'string') return productionOf(this.core, scope);
    return scope.environmentId ?? productionOf(this.core, scope.spaceId);
  }

  /** `environmentOf` for hand-written SQL. */
  protected environmentParam(scope: Scope | ScopedWrite): SQL {
    const environment = this.environmentOf(scope);
    return typeof environment === 'string' ? this.dialect.param(environment, 'uuid') : environment;
  }

  /** Rows of `table` in the scope's space and environment. */
  protected inEnvironment(table: ScopedTable, scope: Scope): SQL {
    return and(
      eq(table.spaceId, scopeSpaceId(scope)),
      eq(table.environmentId, this.environmentOf(scope)),
    ) as SQL;
  }

  /** Runs `fn` now, or after commit when bound to a transaction. */
  protected afterCommit(fn: () => void): void {
    if (this.unit) this.unit.afterCommit(fn);
    else fn();
  }

  /** The row with `id`, or `null`. */
  protected findOne<T extends IdTable>(table: T, id: string): Promise<T['$inferSelect'] | null> {
    return this.findOneWhere(table, eq(table.id, id));
  }

  /** The first row matching `where` in `order`, or `null`. */
  protected async findOneWhere<T extends PgTable>(
    table: T,
    where: SQL | undefined,
    ...order: SQL[]
  ): Promise<T['$inferSelect'] | null> {
    const rows = (await this.db
      .select()
      // A generic `T` fails drizzle's conditional `from()` type; the plain `PgTable` passes it.
      .from(table as PgTable)
      .where(where)
      .orderBy(...order)
      .limit(1)) as T['$inferSelect'][];
    return rows[0] ?? null;
  }

  /** Deletes the row with `id`; false when there was none. */
  protected removeOne<T extends IdTable>(table: T, id: string): Promise<boolean> {
    return this.removeWhere(table, eq(table.id, id));
  }

  /** Deletes the rows matching `where`; false when there were none. */
  protected async removeWhere(table: PgTable, where: SQL | undefined): Promise<boolean> {
    const rows = await this.db.delete(table).where(where).returning({ one: sql<number>`1` });
    return rows.length > 0;
  }

  /**
   * Deletes all but the newest `keep` rows per `partition` value; `scope` limits the rows
   * considered, `removable` limits the rows deleted.
   */
  protected async keepNewest<T extends LogTable>(
    table: T,
    options: {
      partition: PgColumn;
      keep: number;
      scope?: SQL | undefined;
      removable?: SQL | undefined;
    },
  ): Promise<void> {
    const { partition, keep, scope, removable } = options;
    const ranked = sql`
      select ${table.id} as id,
        row_number() over (partition by ${partition} order by ${table.createdAt} desc, ${table.id} desc) as row_rank
      from ${table}
      ${scope ? sql`where ${scope}` : sql``}
    `;
    const stale = sql`${table.id} in (select id from (${ranked}) ranked where row_rank > ${keep})`;
    await this.dialect.run(
      this.db,
      sql`delete from ${table} where ${removable ? and(removable, stale) : stale}`,
    );
  }

  /** Deletes up to `limit` rows matching `where`, oldest first; returns how many went. */
  protected async deleteBatch<T extends LogTable>(
    table: T,
    where: SQL | undefined,
    limit: number,
  ): Promise<number> {
    const due = this.db
      .select({ id: table.id })
      .from(table as PgTable)
      .where(where)
      .orderBy(asc(table.createdAt))
      .limit(limit);
    const rows = await this.db
      .delete(table)
      .where(inArray(table.id, due))
      .returning({ one: sql<number>`1` });
    return rows.length;
  }

  /**
   * Deletes up to `age.limit` of the space's rows older than `age.before`, oldest first, for a
   * retention control; `removable` narrows them. Returns how many went.
   */
  protected pruneAged<T extends LogTable & { spaceId: PgColumn }>(
    table: T,
    age: AgeCutoff,
    removable?: SQL,
  ): Promise<number> {
    return this.deleteBatch(
      table,
      and(eq(table.spaceId, age.spaceId), lt(table.createdAt, age.before), removable),
      age.limit,
    );
  }

  /** Runs `query` per parameter-safe slice of `spaceIds` and groups rows by space; every id gets an entry. */
  protected async bySpaces<T extends { spaceId: string }>(
    spaceIds: readonly string[],
    query: (batch: string[]) => Promise<T[]>,
  ): Promise<Map<string, T[]>> {
    const unique = [...new Set(spaceIds)];
    const out = new Map<string, T[]>(unique.map((spaceId) => [spaceId, []]));
    for (const batch of batches(unique, 1, this.dialect.maxParameters)) {
      for (const row of await query(batch)) out.get(row.spaceId)?.push(row);
    }
    return out;
  }

  /** One page of `table` with its total. */
  protected paginate<T extends PgTable>(
    table: T,
    where: SQL | undefined,
    orderBy: SQL | PgColumn | (SQL | PgColumn)[],
    pagination: Pagination,
  ): Promise<Paginated<T['$inferSelect']>> {
    return paginate(this.db, table, { where, orderBy, pagination });
  }
}
