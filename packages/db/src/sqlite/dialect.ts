import { ManabloxError } from '@manablox/core';
import { getTableName, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import type { Executor } from '../client.js';
import { type Dialect, escapeLike, type ParamType } from '../dialect.js';
import { asNumber, asStringArray, type FieldFilter } from '../query.js';
import { SQLITE_NOW } from './table.js';

interface SqliteExecutor {
  all<T>(query: SQL): Promise<T[]>;
  run(query: SQL): Promise<unknown>;
}

const driver = (db: Executor) => db as unknown as SqliteExecutor;

/** Timestamps are stored as epoch milliseconds. */
const bindable = (value: unknown): unknown => (value instanceof Date ? value.getTime() : value);

const param = (value: unknown, _type: ParamType): SQL =>
  value === null || value === undefined ? sql`null` : sql`${bindable(value)}`;

const like = (left: SQLWrapper, pattern: string): SQL => sql`${left} like ${pattern} escape '\\'`;

/** JSON path of a top-level key. */
const keyPath = (name: string): string => `$."${name.replaceAll('"', '')}"`;

/** A field as Postgres `->>` renders it: booleans as `true`/`false`, JSON null as NULL. */
const fieldText = (fields: SQLWrapper, name: string): SQL => {
  const path = keyPath(name);
  return sql`(case when json_type(${fields}, ${path}) in ('true', 'false')
    then json_type(${fields}, ${path}) else cast(${fields} ->> ${path} as text) end)`;
};

/** Postgres `@>` for one key: equality, or subset for arrays. */
const fieldContains = (fields: SQLWrapper, name: string, value: unknown): SQL => {
  const path = keyPath(name);
  const json = JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    return sql`coalesce(json_type(${fields}, ${path}) = 'array' and not exists (
      select 1 from json_each(${json}) as want
      where not exists (select 1 from json_each(${fields}, ${path}) as have where have.value = want.value)
    ), 0)`;
  }
  return sql`coalesce(${fields} -> ${path} = json(${json}), 0)`;
};

/** websearch syntax: words must all appear; `"phrases"`, `-exclusions` and `or` groups. */
function searchTerms(query: string): { term: string; negated: boolean }[][] {
  const groups: { term: string; negated: boolean }[][] = [[]];
  const pattern = /(-?)"([^"]*)"?|(-?)(\S+)/g;
  for (const match of query.matchAll(pattern)) {
    const phrase = match[2];
    const word = match[4];
    const negated = (phrase !== undefined ? match[1] : match[3]) === '-';
    const term = (phrase ?? word ?? '').trim();
    if (phrase === undefined && term.toLowerCase() === 'or') {
      if (groups.at(-1)?.length) groups.push([]);
      continue;
    }
    if (term) groups.at(-1)?.push({ term, negated });
  }
  return groups.filter((group) => group.some((entry) => !entry.negated));
}

const WORD = /[\p{L}\p{N}]/u;

/** `query` as an FTS5 expression over the `search` column, or `null` if it has no words. */
function ftsQuery(query: string): string | null {
  const phrase = (term: string) => `search:"${term.replaceAll('"', '""')}"`;
  const groups = searchTerms(query)
    .map((group) => group.filter((entry) => WORD.test(entry.term)))
    .filter((group) => group.some((entry) => !entry.negated))
    .map((group) => {
      const wanted = group.filter((entry) => !entry.negated).map((entry) => phrase(entry.term));
      const unwanted = group.filter((entry) => entry.negated).map((entry) => phrase(entry.term));
      const all = `(${wanted.join(' AND ')})`;
      return unwanted.length ? `(${all} NOT (${unwanted.join(' OR ')}))` : all;
    });
  return groups.length ? groups.join(' OR ') : null;
}

/** SQLite's SQL for the shared repositories. */
export function createSqliteDialect(): Dialect {
  // Single-process locks: SQLite already serialises writers, this orders `withLock` holders.
  const held = new Map<string, Promise<void>>();

  return {
    name: 'sqlite',
    maxParameters: 32766,

    rows: <T>(db: Executor, query: SQL) => driver(db).all<T>(query),
    async run(db, query) {
      await driver(db).run(query);
    },

    param,
    values(columns, rows) {
      const names = Object.keys(columns);
      const tuples = rows.map(
        (row) =>
          sql`(${sql.join(
            names.map((name) => param(row[name], columns[name] as ParamType)),
            sql`, `,
          )})`,
      );
      const select = names.map(
        (name, index) => sql`${sql.raw(`column${index + 1}`)} as ${sql.identifier(name)}`,
      );
      return sql`(select ${sql.join(select, sql`, `)} from (values ${sql.join(tuples, sql`, `)}))`;
    },
    now: () => SQLITE_NOW,

    ilike: like,
    jsonText: (column) => sql`${column}`,
    jsonArrayWithout: (column, pattern) =>
      sql`(select json_group_array(value) from json_each(${column}) where value not like ${pattern})`,
    jsonMerge(column, patch) {
      const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
      if (entries.length === 0) return sql`${column}`;
      const pairs = entries.map(
        ([key, value]) => sql`${keyPath(key)}, json(${JSON.stringify(value)})`,
      );
      return sql`json_set(${column}, ${sql.join(pairs, sql`, `)})`;
    },
    jsonArrayLength: (column) => sql`json_array_length(${column})`,
    jsonObjectWith: (value, key, expression) =>
      sql`json_set(${JSON.stringify(value)}, ${keyPath(key)}, ${expression})`,
    jsonFieldEquals: (fields, name, value) =>
      sql`${fields} -> ${keyPath(name)} = json(${JSON.stringify(value)})`,

    // A range, so the path index serves it: descendants continue with `.`, which sorts below `/`.
    pathWithin: (path, ancestor) => sql`(${path} >= ${ancestor} and ${path} < ${ancestor} || '/')`,
    // The ancestors' ids are the path's labels, so each is a primary-key lookup.
    isAncestorRow: (alias, path) => sql`${sql.identifier(alias)}.id in (
      select replace(value, '_', '-') from json_each('["' || replace(${path}, '.', '","') || '"]')
    )`,
    pathDepth: (path) => sql`(length(${path}) - length(replace(${path}, '.', '')) + 1)`,
    pathRebase: (path, oldPrefix, newPrefix) =>
      sql`${newPrefix} || substr(${path}, length(${oldPrefix}) + 1)`,

    // An FTS5 index per content table, kept by triggers; see `0001_extras.sql`.
    search(table, query) {
      const expression = ftsQuery(query);
      if (!expression) return sql`0`;
      const index = sql.identifier(`${getTableName(table)}_search`);
      return sql`${table.id} in (select content_id from ${index} where ${index} match ${expression})`;
    },
    fieldCondition,

    forUpdate: (query) => query,
    // Every transaction is `BEGIN IMMEDIATE`, which already holds the write lock.
    async lockInTransaction() {},
    async withLock(_db, name, fn) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const previous = held.get(name) ?? Promise.resolve();
      const current = previous.then(() => gate);
      held.set(name, current);
      await previous;
      try {
        return await fn();
      } finally {
        release();
        if (held.get(name) === current) held.delete(name);
      }
    },
  };
}

function fieldCondition(fields: SQLWrapper, filter: FieldFilter): SQL {
  const path = keyPath(filter.name);
  const value = sql`${fields} -> ${path}`;
  const text = fieldText(fields, filter.name);
  const list = () =>
    sql.join(
      asStringArray(filter.value).map((entry) => sql`${entry}`),
      sql`, `,
    );

  switch (filter.op) {
    case 'eq':
      return fieldContains(fields, filter.name, filter.value);
    case 'neq':
      return sql`not ${fieldContains(fields, filter.name, filter.value)}`;
    case 'in':
      return sql`${text} in (${list()})`;
    case 'notIn':
      return sql`${text} not in (${list()})`;
    case 'lt':
      return sql`cast(${text} as real) < ${asNumber(filter.value)}`;
    case 'lte':
      return sql`cast(${text} as real) <= ${asNumber(filter.value)}`;
    case 'gt':
      return sql`cast(${text} as real) > ${asNumber(filter.value)}`;
    case 'gte':
      return sql`cast(${text} as real) >= ${asNumber(filter.value)}`;
    case 'contains':
      return like(text, `%${escapeLike(String(filter.value ?? ''))}%`);
    case 'startsWith':
      return like(text, `${escapeLike(String(filter.value ?? ''))}%`);
    case 'endsWith':
      return like(text, `%${escapeLike(String(filter.value ?? ''))}`);
    case 'isNull':
      return sql`(${value} is null or ${value} = 'null')`;
    case 'isNotNull':
      return sql`(${value} is not null and ${value} <> 'null')`;
    default: {
      const exhaustive: never = filter.op;
      throw ManabloxError.badRequest('query.operator.unsupported', { op: exhaustive });
    }
  }
}
