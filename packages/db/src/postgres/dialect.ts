import { ManabloxError } from '@manablox/core';
import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { type Dialect, escapeLike, type ParamType } from '../dialect.js';
import { asNumber, asStringArray, type FieldFilter } from '../query.js';

const CASTS: Record<ParamType, string> = {
  uuid: 'uuid',
  text: 'text',
  int: 'int',
  timestamptz: 'timestamptz',
  ltree: 'ltree',
};

/** Raw templates cannot bind a `Date`; it is sent as ISO text and cast. */
const bindable = (value: unknown): unknown => (value instanceof Date ? value.toISOString() : value);

const param = (value: unknown, type: ParamType): SQL =>
  value === null || value === undefined
    ? sql`null::${sql.raw(CASTS[type])}`
    : sql`${bindable(value)}::${sql.raw(CASTS[type])}`;

const locks = (db: Executor, name: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtext(${name}))`);

export const postgresDialect: Dialect = {
  name: 'postgres',
  // The wire protocol's 16-bit bind parameter count; the driver refuses at 65534.
  maxParameters: 65534,

  async rows<T>(db: Executor, query: SQL) {
    return (await db.execute(query)) as unknown as T[];
  },
  async run(db, query) {
    await db.execute(query);
  },

  param,
  values(columns, rows) {
    const names = Object.keys(columns);
    const arrays = names.map((name) => {
      const type = columns[name] as ParamType;
      const list = sql.join(
        rows.map((row) => param(row[name], type)),
        sql`, `,
      );
      return sql`unnest(array[${list}]) as ${sql.identifier(name)}`;
    });
    return sql`(select ${sql.join(arrays, sql`, `)})`;
  },
  now: () => sql`now()`,

  ilike: (left, pattern) => sql`${left} ilike ${pattern}`,
  jsonText: (column) => sql`${column}::text`,
  jsonArrayWithout: (column, pattern) => sql`(
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    from jsonb_array_elements_text(${column}) as value
    where value not like ${pattern}
  )`,
  jsonMerge: (column, patch) => sql`${column} || ${JSON.stringify(patch)}::jsonb`,
  jsonArrayLength: (column) => sql`jsonb_array_length(${column})`,
  jsonObjectWith: (value, key, expression) =>
    sql`${JSON.stringify(value)}::jsonb || jsonb_build_object(${key}::text, ${expression})`,
  // `@>` uses the GIN index; the equality rules out arrays that merely contain the value.
  jsonFieldEquals: (
    fields,
    name,
    value,
  ) => sql`${fields} @> ${JSON.stringify({ [name]: value })}::jsonb
    and ${fields} -> ${name}::text = ${JSON.stringify(value)}::jsonb`,

  pathWithin: (path, ancestor) => sql`${path} <@ ${ancestor}`,
  isAncestorRow: (alias, path) => sql`${sql.identifier(alias)}.path @> ${path}`,
  pathDepth: (path) => sql`nlevel(${path})`,
  pathRebase: (path, oldPrefix, newPrefix) =>
    sql`${newPrefix}::ltree || subpath(${path}, nlevel(${oldPrefix}::ltree))`,

  search: (table, query) => sql`${table.search} @@ websearch_to_tsquery('simple', ${query})`,
  fieldCondition,

  forUpdate<T>(query: T): T {
    return (query as unknown as { for: (strength: 'update') => T }).for('update');
  },
  async lockInTransaction(tx, name) {
    await locks(tx, name);
  },
  // A transactional lock, released even if the process dies. `fn` runs on the pool so its
  // writes commit as they go; a pool of one would deadlock.
  withLock(db, name, fn) {
    return db.transaction(async (tx) => {
      await locks(tx, name);
      return fn();
    });
  },
};

function fieldCondition(fields: SQLWrapper, filter: FieldFilter): SQL {
  const path = sql`${fields} -> ${filter.name}`;
  const text = sql`${fields} ->> ${filter.name}`;

  switch (filter.op) {
    case 'eq':
      // jsonb containment, so the `jsonb_path_ops` GIN index can serve it.
      return sql`${fields} @> jsonb_build_object(${filter.name}::text, ${JSON.stringify(filter.value ?? null)}::jsonb)`;
    case 'neq':
      return sql`not (${fields} @> jsonb_build_object(${filter.name}::text, ${JSON.stringify(filter.value ?? null)}::jsonb))`;
    case 'in':
      return sql`${text} = any(${sql.param(asStringArray(filter.value))}::text[])`;
    case 'notIn':
      return sql`${text} <> all(${sql.param(asStringArray(filter.value))}::text[])`;
    case 'lt':
      return sql`(${text})::numeric < ${asNumber(filter.value)}`;
    case 'lte':
      return sql`(${text})::numeric <= ${asNumber(filter.value)}`;
    case 'gt':
      return sql`(${text})::numeric > ${asNumber(filter.value)}`;
    case 'gte':
      return sql`(${text})::numeric >= ${asNumber(filter.value)}`;
    case 'contains':
      return sql`${text} ilike ${`%${escapeLike(String(filter.value ?? ''))}%`}`;
    case 'startsWith':
      return sql`${text} ilike ${`${escapeLike(String(filter.value ?? ''))}%`}`;
    case 'endsWith':
      return sql`${text} ilike ${`%${escapeLike(String(filter.value ?? ''))}`}`;
    case 'isNull':
      return sql`(${path} is null or ${path} = 'null'::jsonb)`;
    case 'isNotNull':
      return sql`(${path} is not null and ${path} <> 'null'::jsonb)`;
    default: {
      const exhaustive: never = filter.op;
      throw ManabloxError.badRequest('query.operator.unsupported', { op: exhaustive });
    }
  }
}
